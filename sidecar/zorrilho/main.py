import os
import shutil
import sqlite3
import threading
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
import asyncio
import json
import time

from fastapi import WebSocket, WebSocketDisconnect

DATA_DIR = Path(os.environ.get("ZORRILHO_DATA_DIR", Path.home() / ".local/share/zorrilho"))
DB_PATH = DATA_DIR / "zorrilho.db"
MODELS_DIR = DATA_DIR / "models"
REFS_DIR = DATA_DIR / "refs"
OUT_DIR = DATA_DIR / "out"

os.environ.setdefault("COQUI_TOS_AGREED", "1")
os.environ.setdefault("HF_HOME", str(DATA_DIR / "hf"))
# redireciona o cache do Coqui (~/.local/share/tts) para o dir do app
os.environ["TTS_HOME"] = str(MODELS_DIR)

app = FastAPI(title="Zorrilho sidecar")

_tts = None
_tts_lock = threading.Lock()


def get_tts():
    global _tts
    with _tts_lock:
        if _tts is None:
            from TTS.api import TTS

            _tts = TTS(model_name="tts_models/multilingual/multi-dataset/xtts_v2", gpu=True)
    return _tts


def init_db() -> None:
    for d in (DATA_DIR, MODELS_DIR, REFS_DIR, OUT_DIR):
        d.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as db:
        db.row_factory = sqlite3.Row
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS voice_profiles (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                kind TEXT NOT NULL DEFAULT 'cloned',
                engine TEXT NOT NULL DEFAULT 'xtts_v2',
                ref_audio_path TEXT,
                ref_text TEXT,
                embedding_path TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS generation_history (
                id TEXT PRIMARY KEY,
                voice_profile_id TEXT NOT NULL REFERENCES voice_profiles(id),
                text TEXT NOT NULL,
                output_path TEXT,
                engine TEXT NOT NULL,
                duration_ms INTEGER,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            """
        )


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "db": str(DB_PATH), "model_loaded": _tts is not None}


# ---------- profiles ----------


class ProfileIn(BaseModel):
    name: str
    ref_text: str | None = None


@app.get("/api/profiles")
def list_profiles() -> list[dict]:
    with sqlite3.connect(DB_PATH) as db:
        db.row_factory = sqlite3.Row
        rows = db.execute("SELECT * FROM voice_profiles ORDER BY created_at DESC").fetchall()
    return [dict(r) for r in rows]


@app.post("/api/profiles")
async def create_profile(
    name: str = Form(...), ref_text: str | None = Form(None), ref_audio: UploadFile = File(...)
) -> dict:
    pid = uuid.uuid4().hex
    ext = Path(ref_audio.filename or "ref.wav").suffix or ".wav"
    ref_path = REFS_DIR / pid / f"ref{ext}"
    ref_path.parent.mkdir(parents=True, exist_ok=True)
    with ref_path.open("wb") as f:
        shutil.copyfileobj(ref_audio.file, f)
    with sqlite3.connect(DB_PATH) as db:
        db.execute(
            "INSERT INTO voice_profiles (id, name, ref_audio_path, ref_text) VALUES (?,?,?,?)",
            (pid, name, str(ref_path), ref_text),
        )
    return {"id": pid, "name": name, "ref_audio_path": str(ref_path)}


@app.delete("/api/profiles/{pid}")
def delete_profile(pid: str) -> dict:
    with sqlite3.connect(DB_PATH) as db:
        cur = db.execute("DELETE FROM voice_profiles WHERE id=?", (pid,))
    if cur.rowcount == 0:
        raise HTTPException(404, "profile not found")
    return {"deleted": pid}


# ---------- generation ----------


_progress: dict[str, dict] = {}  # task_id -> last event


@app.websocket("/ws/progress/{task_id}")
async def ws_progress(ws: WebSocket, task_id: str) -> None:
    await ws.accept()
    last_sent: dict | None = None
    try:
        while True:
            ev = _progress.get(task_id)
            if ev is not None and ev != last_sent:
                await ws.send_text(json.dumps(ev))
                last_sent = ev.copy()
                if ev.get("stage") in ("done", "error"):
                    break
            await asyncio.sleep(0.2)
    except WebSocketDisconnect:
        pass

def report(task_id: str, stage: str, progress: float = 0.0, **extra) -> None:
    _progress[task_id] = {"stage": stage, "progress": progress, **extra}


class GenerateIn(BaseModel):
    text: str
    profile_id: str
    language: str = "pt"


@app.post("/api/generate")
async def generate(req: GenerateIn) -> dict:
    with sqlite3.connect(DB_PATH) as db:
        db.row_factory = sqlite3.Row
        row = db.execute("SELECT * FROM voice_profiles WHERE id=?", (req.profile_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "profile not found")

    task_id = uuid.uuid4().hex
    out_path = OUT_DIR / f"{task_id}.wav"
    report(task_id, "queued", 0)

    async def run() -> None:
        loop = asyncio.get_running_loop()
        t0 = time.monotonic()

        def synth() -> float:
            report(task_id, "loading_model", 10)
            tts = get_tts()
            report(task_id, "synthesis", 50)
            tts.tts_to_file(
                text=req.text,
                speaker_wav=row["ref_audio_path"],
                language=req.language,
                file_path=str(out_path),
            )
            return time.monotonic() - t0

        try:
            elapsed = await loop.run_in_executor(None, synth)
            import soundfile as sf

            info = sf.info(str(out_path))
            with sqlite3.connect(DB_PATH) as db:
                db.execute(
                    "INSERT INTO generation_history (id, voice_profile_id, text, output_path, engine, duration_ms) "
                    "VALUES (?,?,?,?,?,?)",
                    (task_id, req.profile_id, req.text, str(out_path), "xtts_v2", int(info.duration * 1000)),
                )
            report(task_id, "done", 100, generation_id=task_id, output_path=str(out_path),
                   duration_ms=int(info.duration * 1000), elapsed_s=round(elapsed, 2))
        except Exception as e:
            report(task_id, "error", 100, error=str(e))

    asyncio.get_running_loop().create_task(run())
    return {"task_id": task_id, "status": "queued"}


@app.get("/api/generations/{gid}/audio")
def get_audio(gid: str) -> FileResponse:
    with sqlite3.connect(DB_PATH) as db:
        db.row_factory = sqlite3.Row
        row = db.execute("SELECT output_path FROM generation_history WHERE id=?", (gid,)).fetchone()
    if row is None:
        raise HTTPException(404, "generation not found")
    return FileResponse(row["output_path"], media_type="audio/wav")
