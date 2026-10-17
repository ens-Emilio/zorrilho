import asyncio
import json
import os
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import soundfile as sf
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from zorrilho import downloader
from zorrilho.config import DATA_DIR, DB_PATH, HUSHMIC_DIR, MODELS_DIR, OUT_DIR, REFS_DIR, MAX_REF_BYTES
from zorrilho.engines import get_engine
from zorrilho.models import Base, GenerationHistory, VoiceProfile

os.environ.setdefault("COQUI_TOS_AGREED", "1")
os.environ.setdefault("HF_HOME", str(DATA_DIR / "hf"))
os.environ["TTS_HOME"] = str(MODELS_DIR)

# Engine: allow cross-thread use (FastAPI threadpool for sync handlers)
_engine = create_engine(f"sqlite:///{DB_PATH}", echo=False, connect_args={"check_same_thread": False})
_Session = sessionmaker(bind=_engine)

# Progress store: thread-safe + TTL eviction
_progress: dict[str, dict] = {}
_progress_lock = threading.Lock()
_PROGRESS_TTL_S = 3600
_PROGRESS_MAX = 200


def _prune_progress() -> None:
    now = time.monotonic()
    with _progress_lock:
        # evict expired (older than TTL) — keep if missing _ts
        expired = [k for k, v in _progress.items() if now - v.get("_ts", now) > _PROGRESS_TTL_S]
        for k in expired:
            _progress.pop(k, None)
        # cap size: drop oldest
        if len(_progress) > _PROGRESS_MAX:
            oldest = sorted(_progress.items(), key=lambda kv: kv[1].get("_ts", 0))
            for k, _ in oldest[: len(_progress) - _PROGRESS_MAX]:
                _progress.pop(k, None)


def init_db() -> None:
    for d in (DATA_DIR, REFS_DIR, OUT_DIR, MODELS_DIR, HUSHMIC_DIR):
        d.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(_engine)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Zorrilho sidecar", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    with _Session() as s:
        has_profile = s.scalar(select(VoiceProfile.id).limit(1)) is not None
        n_gens = s.scalar(select(GenerationHistory.id).limit(1)) is not None
    _ = has_profile, n_gens  # keep query warm; response shape below
    return {
        "status": "ok",
        "db": str(DB_PATH),
        "models_dir": str(MODELS_DIR),
        "hushmic_assets": downloader.assets_ok(),
    }


# ---------- assets ----------


@app.post("/api/assets/ensure")
async def ensure_assets() -> dict:
    """Download missing HushMic assets (XTTS v2 is lazy inside Coqui)."""
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
        raise HTTPException(422, "engine must be xtts_v2 or gpt_sovits")
    name = name.strip()
    if len(name) < 2:
        raise HTTPException(422, "name must have at least 2 characters")
    if len(name) > 80:
        raise HTTPException(422, "name too long (max 80)")
    # size guard: read with cap
    raw = await ref_audio.read()
    if len(raw) == 0:
        raise HTTPException(422, "empty audio file")
    if len(raw) > MAX_REF_BYTES:
        raise HTTPException(413, f"audio too large (max {MAX_REF_BYTES // (1024*1024)} MiB)")
    # light audio validation: must be decodable by soundfile, >= 1s
    try:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp.write(raw)
            tmp_path = tmp.name
        try:
            info = sf.info(tmp_path)
            if info.duration < 1.0:
                raise HTTPException(422, "audio too short (need at least 1s; 6s recommended)")
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(422, f"invalid audio file: {e}")

    pid = uuid.uuid4().hex
    # sanitize extension: only wav/mp3/ogg/flac
    orig_suffix = Path(ref_audio.filename or "ref.wav").suffix.lower()
    if orig_suffix not in (".wav", ".mp3", ".ogg", ".flac", ".m4a"):
        orig_suffix = ".wav"
    ref_path = REFS_DIR / pid / f"ref{orig_suffix}"
    ref_path.parent.mkdir(parents=True, exist_ok=True)
    ref_path.write_bytes(raw)

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
        # delete generations that reference this profile
        gens = s.scalars(select(GenerationHistory).where(GenerationHistory.voice_profile_id == pid)).all()
        for g in gens:
            # remove output files
            if g.output_path:
                try:
                    Path(g.output_path).unlink(missing_ok=True)
                    Path(g.output_path).with_suffix(".mp3").unlink(missing_ok=True)
                except OSError:
                    pass
            s.delete(g)
        s.delete(obj)
        s.commit()
    # remove ref dir
    shutil.rmtree(REFS_DIR / pid, ignore_errors=True)
    return {"deleted": pid}


# ---------- generation ----------


@app.websocket("/ws/progress/{task_id}")
async def ws_progress(ws: WebSocket, task_id: str) -> None:
    await ws.accept()
    last_sent: dict | None = None
    try:
        while True:
            with _progress_lock:
                ev = _progress.get(task_id)
                # copy without internal _ts
                ev_public = {k: v for k, v in ev.items() if k != "_ts"} if ev else None
            if ev_public is not None and ev_public != last_sent:
                await ws.send_text(json.dumps(ev_public))
                last_sent = ev_public
                if ev_public.get("stage") in ("done", "error"):
                    break
            await asyncio.sleep(0.2)
    except WebSocketDisconnect:
        pass


def report(task_id: str, stage: str, progress: float = 0.0, **extra) -> None:
    with _progress_lock:
        _progress[task_id] = {"stage": stage, "progress": progress, "_ts": time.monotonic(), **extra}
    _prune_progress()


class GenerateIn(BaseModel):
    text: str
    profile_id: str
    language: str = "pt"


@app.post("/api/generate")
async def generate(req: GenerateIn) -> dict:
    text = req.text.strip()
    if not text:
        raise HTTPException(422, "text must not be empty")
    if len(text) > 8000:
        raise HTTPException(422, "text too long (max 8000 characters)")
    with _Session() as s:
        row = s.get(VoiceProfile, req.profile_id)
    if row is None:
        raise HTTPException(404, "profile not found")
    # detach needed fields before async boundary
    engine_name = row.engine
    ref_audio_path = row.ref_audio_path
    if not ref_audio_path or not Path(ref_audio_path).exists():
        raise HTTPException(422, "profile has no valid reference audio")

    task_id = uuid.uuid4().hex
    out_path = OUT_DIR / f"{task_id}.wav"
    report(task_id, "queued", 0)

    async def run() -> None:
        loop = asyncio.get_running_loop()

        def synth() -> float:
            eng = get_engine(engine_name)
            report(task_id, "loading_model", 10)
            # small yield so client sees the 10% stage before synthesis overwrites
            time.sleep(0.15)
            report(task_id, "synthesis", 50)
            return eng.synth(text, ref_audio_path, req.language, out_path)

        try:
            elapsed = await loop.run_in_executor(None, synth)
            info = sf.info(str(out_path))
            with _Session() as s:
                s.add(
                    GenerationHistory(
                        id=task_id,
                        voice_profile_id=req.profile_id,
                        text=text,
                        output_path=str(out_path),
                        engine=engine_name,
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
    if row is None or not row.output_path:
        raise HTTPException(404, "generation not found")
    p = Path(row.output_path)
    if not p.exists():
        raise HTTPException(404, "audio file not found on disk")
    return FileResponse(str(p), media_type="audio/wav")


@app.get("/api/generations")
def list_generations(profile_id: str | None = None) -> list[dict]:
    with _Session() as s:
        stmt = (
            select(GenerationHistory).where(GenerationHistory.voice_profile_id == profile_id)
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
    """Export a generation. mp3 via ffmpeg ( ?format=mp3 )."""
    if format not in ("wav", "mp3"):
        raise HTTPException(422, "format must be wav or mp3")
    with _Session() as s:
        row = s.get(GenerationHistory, gid)
    if row is None or not row.output_path:
        raise HTTPException(404, "generation not found")
    src = Path(row.output_path)
    if not src.exists():
        raise HTTPException(404, "audio file not found on disk")

    if format == "wav":
        return FileResponse(str(src), media_type="audio/wav", filename=f"{gid}.wav")

    out_path = src.with_suffix(".mp3")
    if not out_path.exists():
        try:
            subprocess.run(
                ["ffmpeg", "-y", "-i", str(src), "-codec:a", "libmp3lame", "-qscale:a", "2", str(out_path)],
                check=True,
                capture_output=True,
                timeout=30,
            )
        except FileNotFoundError:
            raise HTTPException(500, "ffmpeg not found — install ffmpeg for MP3 export")
        except subprocess.TimeoutExpired:
            raise HTTPException(500, "ffmpeg timed out")
        except subprocess.CalledProcessError as e:
            raise HTTPException(500, f"ffmpeg failed: {e.stderr.decode(errors='ignore')[:300]}")
    return FileResponse(str(out_path), media_type="audio/mpeg", filename=f"{gid}.mp3")
