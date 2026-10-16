import asyncio
import json
import os
import shutil
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from zorrilho import downloader
from zorrilho.engines import get_engine
from zorrilho.models import Base, GenerationHistory, VoiceProfile

DATA_DIR = Path(os.environ.get("ZORRILHO_DATA_DIR", Path.home() / ".local/share/zorrilho"))
DB_PATH = DATA_DIR / "zorrilho.db"
REFS_DIR = DATA_DIR / "refs"
OUT_DIR = DATA_DIR / "out"

os.environ.setdefault("COQUI_TOS_AGREED", "1")
os.environ.setdefault("HF_HOME", str(DATA_DIR / "hf"))
os.environ["TTS_HOME"] = str(DATA_DIR / "models")

app = FastAPI(title="Zorrilho sidecar")

# SQLAlchemy sync ( queries curtas em SQLite; thread pool do FastAPI cobre )
_engine = create_engine(f"sqlite:///{DB_PATH}", echo=False)
_Session = sessionmaker(bind=_engine)


def init_db() -> None:
    for d in (DATA_DIR, REFS_DIR, OUT_DIR, DATA_DIR / "models"):
        d.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(_engine)


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.get("/health")
def health() -> dict:
    with _Session() as s:
        n_profiles = s.scalar(select(VoiceProfile.id).limit(1)) is not None
    return {
        "status": "ok",
        "db": str(DB_PATH),
        "models_dir": str(DATA_DIR / "models"),
    "hushmic_assets": downloader.assets_ok(),
    }


# ---------- assets ----------


@app.post("/api/assets/ensure")
async def ensure_assets() -> dict:
    """Baixa assets HushMic faltantes (XTTS v2 é lazy no Coqui)."""
    events: list[dict] = []

    def cb(done: int, total: int, name: str) -> None:
        events.append({"asset": name, "done": done, "total": total})

    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, downloader.ensure_hushmic_assets, cb)
    return {"status": "ok", "events": events}


# ---------- profiles ----------


@app.get("/api/profiles")
def list_profiles() -> list[dict]:
    with _Session() as s:
        rows = s.scalars(select(VoiceProfile).order_by(VoiceProfile.created_at.desc())).all()
    return [
        {
            "id": r.id,
            "name": r.name,
            "kind": r.kind,
            "engine": r.engine,
            "ref_audio_path": r.ref_audio_path,
            "ref_text": r.ref_text,
            "created_at": str(r.created_at),
        }
        for r in rows
    ]


@app.post("/api/profiles")
async def create_profile(
    name: str = Form(...),
    engine: str = Form("xtts_v2"),
    ref_text: str | None = Form(None),
    ref_audio: UploadFile = File(...),
) -> dict:
    if engine not in ("xtts_v2", "gpt_sovits"):
        raise HTTPException(422, "engine deve ser xtts_v2 ou gpt_sovits")
    pid = uuid.uuid4().hex
    ext = Path(ref_audio.filename or "ref.wav").suffix or ".wav"
    ref_path = REFS_DIR / pid / f"ref{ext}"
    ref_path.parent.mkdir(parents=True, exist_ok=True)
    with ref_path.open("wb") as f:
        shutil.copyfileobj(ref_audio.file, f)
    with _Session() as s:
        s.add(VoiceProfile(id=pid, name=name, engine=engine, ref_audio_path=str(ref_path), ref_text=ref_text))
        s.commit()
    return {"id": pid, "name": name, "engine": engine, "ref_audio_path": str(ref_path)}


@app.delete("/api/profiles/{pid}")
def delete_profile(pid: str) -> dict:
    with _Session() as s:
        obj = s.get(VoiceProfile, pid)
        if obj is None:
            raise HTTPException(404, "profile not found")
        s.delete(obj)
        s.commit()
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
    with _Session() as s:
        row = s.get(VoiceProfile, req.profile_id)
    if row is None:
        raise HTTPException(404, "profile not found")

    task_id = uuid.uuid4().hex
    out_path = OUT_DIR / f"{task_id}.wav"
    report(task_id, "queued", 0)

    async def run() -> None:
        loop = asyncio.get_running_loop()

        def synth() -> float:
            engine = get_engine(row.engine)
            report(task_id, "loading_model", 10)
            report(task_id, "synthesis", 50)
            return engine.synth(req.text, row.ref_audio_path, req.language, out_path)

        try:
            elapsed = await loop.run_in_executor(None, synth)
            import soundfile as sf

            info = sf.info(str(out_path))
            with _Session() as s:
                s.add(
                    GenerationHistory(
                        id=task_id,
                        voice_profile_id=req.profile_id,
                        text=req.text,
                        output_path=str(out_path),
                        engine=row.engine,
                        duration_ms=int(info.duration * 1000),
                    )
                )
                s.commit()
            report(
                task_id,
                "done",
                100,
                generation_id=task_id,
                output_path=str(out_path),
                duration_ms=int(info.duration * 1000),
                elapsed_s=round(elapsed, 2),
            )
        except Exception as e:
            report(task_id, "error", 100, error=str(e))

    asyncio.get_running_loop().create_task(run())
    return {"task_id": task_id, "status": "queued"}


@app.get("/api/generations/{gid}/audio")
def get_audio(gid: str) -> FileResponse:
    with _Session() as s:
        row = s.get(GenerationHistory, gid)
    if row is None:
        raise HTTPException(404, "generation not found")
    return FileResponse(row.output_path, media_type="audio/wav")

@app.get("/api/generations")
def list_generations(profile_id: str | None = None) -> list[dict]:
    with _Session() as s:
        stmt = (
            select(GenerationHistory)
            .where(GenerationHistory.voice_profile_id == profile_id)
            if profile_id
            else select(GenerationHistory)
        )
        rows = s.scalars(stmt.order_by(GenerationHistory.created_at.desc())).all()
    return [
        {
            "id": r.id,
            "voice_profile_id": r.voice_profile_id,
            "text": r.text,
            "output_path": r.output_path,
            "engine": r.engine,
            "duration_ms": r.duration_ms,
            "created_at": str(r.created_at),
        }
        for r in rows
    ]


@app.get("/api/generations/{gid}/export")
def export_audio(gid: str, format: str = "wav") -> FileResponse:
    """Exporta a geracao. mp3 via ffmpeg ( requisição :format=mp3 )."""
    import subprocess
    import tempfile

    if format not in ("wav", "mp3"):
        raise HTTPException(422, "format deve ser wav ou mp3")
    with _Session() as s:
        row = s.get(GenerationHistory, gid)
    if row is None or not row.output_path:
        raise HTTPException(404, "generation not found")

    if format == "wav":
        return FileResponse(row.output_path, media_type="audio/wav", filename=f"{gid}.wav")

    out_path = Path(row.output_path).with_suffix(".mp3")
    if not out_path.exists():
        subprocess.run(
            ["ffmpeg", "-y", "-i", row.output_path, "-codec:a", "libmp3lame", "-qscale:a", "2", str(out_path)],
            check=True,
            capture_output=True,
        )
    return FileResponse(out_path, media_type="audio/mpeg", filename=f"{gid}.mp3")
