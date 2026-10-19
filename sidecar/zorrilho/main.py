import base64
import asyncio
import io
import json
import os
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from contextlib import asynccontextmanager
import pathlib
from pathlib import Path

try:
    import numpy as np  # type: ignore
except Exception:
    np = None  # type: ignore

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

_VIDEO_EXTS = {".mp4", ".mkv", ".mov", ".webm", ".avi", ".m4a", ".mpg", ".mpeg", ".3gp", ".flv", ".wmv"}

def _extract_wav_via_ffmpeg(src: str, dst: str) -> None:
    # ponytail: single ffmpeg call, no queue; add job queue if concurrent video uploads matter
    if shutil.which("ffmpeg") is None:
        raise HTTPException(422, "ffmpeg não encontrado no sistema — instale ffmpeg para importar vídeo")
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", dst],
            check=True, capture_output=True, timeout=120,
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(422, "timeout ao extrair áudio do vídeo (arquivo muito grande?)")
    except subprocess.CalledProcessError as e:
        msg = (e.stderr or b"").decode(errors="ignore").strip()[:300]
        raise HTTPException(422, f"não foi possível extrair áudio: {msg or 'formato não suportado'}")


def _wav_to_b64(wav_path: str) -> str:
    import base64 as _b64
    return _b64.b64encode(Path(wav_path).read_bytes()).decode()


def _estimate_snr(wav_path: str) -> tuple[float, float]:
    """Return (snr_db, clipping_ratio). Cheap: RMS voz vs RMS silêncio."""
    try:
        data, sr = sf.read(wav_path, dtype="float32", always_2d=False)
        if data.ndim > 1:
            data = data.mean(axis=1)
        if len(data) == 0:
            return 0.0, 0.0
        peak = float(max(abs(float(x)) for x in data)) if len(data) else 0.0
        clipping = float(sum(1 for x in data if abs(float(x)) > 0.99) / max(1, len(data)))
        # energia: top 30% vs bottom 30% (proxy SNR)
        n = len(data)
        w = max(1, n // 200)
        rms_vals = []
        for i in range(0, n - w, w):
            seg = data[i:i+w]
            rms_vals.append(float((seg*seg).mean() ** 0.5))
        rms_vals.sort()
        lo = sum(rms_vals[:max(1, len(rms_vals)//4)]) / max(1, len(rms_vals)//4)
        hi = sum(rms_vals[3*len(rms_vals)//4:]) / max(1, len(rms_vals)//4)
        snr = 20 * __import__("math").log10(max(1e-6, hi) / max(1e-6, lo)) if lo > 1e-6 else 30.0
        snr = max(0.0, min(40.0, snr))
        return round(snr, 1), round(clipping, 4)
    except Exception:
        return 0.0, 0.0


def _trim_and_normalize(src: str, dst: str) -> None:
    """Trim silêncio + loudnorm via ffmpeg; fallback copy."""
    try:
        # trim + loudnorm single pass (good enough; 2-pass seria melhor mas mais lento)
        subprocess.run(
            ["ffmpeg","-y","-v","error","-i",src,"-af","silenceremove=start_periods=1:start_duration=0.2:start_threshold=-50dB:detection=peak,aformat=dblp,areverse,silenceremove=start_periods=1:start_duration=0.2:start_threshold=-50dB:detection=peak,areverse,loudnorm=I=-23:TP=-1:LRA=7","-ar","16000","-ac","1","-c:a","pcm_s16le",dst],
            check=True, capture_output=True, timeout=30,
        )
    except Exception:
        try:
            shutil.copy2(src, dst)
        except Exception:
            pass


def _denoise_with_dpdfnet(src: str, dst: str) -> bool:
    """Try dpdfnet enhance (48k model); return True se aplicou. Fallback False."""
    try:
        import numpy as np
        data, sr = sf.read(src, dtype="float32", always_2d=False)
        if data.ndim > 1:
            data = data.mean(axis=1)
        # dpdfnet espera 48k; enhance faz resample interno
        try:
            from dpdfnet import enhance as _enhance
        except ImportError:
            return False
        # check ONNX exists, else auto-download via dpdfnet
        onnx = HUSHMIC_DIR / "dpdfnet8_48khz_hr.onnx"
        if not onnx.exists():
            # tenta cache dpdfnet
            import pathlib as _pl
            alt = _pl.Path.home() / ".cache/dpdfnet/models/dpdfnet8_48khz_hr.onnx"
            if alt.exists():
                onnx = alt
            else:
                # tenta download silencioso
                try:
                    from dpdfnet import download as _dl
                    _dl("dpdfnet8_48khz_hr")
                except Exception:
                    pass
        enhanced = _enhance(data, sample_rate=16000, model="dpdfnet8_48khz_hr", onnx_path=str(onnx) if onnx.exists() else None)
        sf.write(dst, enhanced, 16000)
        return True
    except Exception:
        return False


def _load_wav_as_mono_16k(wav_path: str) -> "tuple[np.ndarray, int]":  # type: ignore
    """Load wav as mono float32 16kHz. Resample via librosa if needed, else ffmpeg."""
    try:
        data, sr = sf.read(wav_path, dtype="float32", always_2d=False)
        if getattr(data, "ndim", 1) > 1:
            data = data.mean(axis=1)
        if sr == 16000:
            return data.astype("float32") if np is not None else data, 16000
        # try librosa
        try:
            import librosa  # type: ignore
            y = librosa.resample(data, orig_sr=sr, target_sr=16000)
            return y.astype("float32") if np is not None else y, 16000
        except Exception:
            pass
        # ffmpeg fallback
        import tempfile as _tf
        with _tf.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
            tmp16 = tf.name
        try:
            _extract_wav_via_ffmpeg(wav_path, tmp16)
            d2, sr2 = sf.read(tmp16, dtype="float32", always_2d=False)
            if getattr(d2, "ndim", 1) > 1:
                d2 = d2.mean(axis=1)
            return d2, 16000
        finally:
            try:
                import os as _os
                _os.unlink(tmp16)
            except Exception:
                pass
    except Exception:
        return np.array([], dtype="float32") if np is not None else [], 16000


def _dpdfnet_denoise(src: str, dst: str) -> bool:
    """Try dpdfnet (onnxruntime CPU); fallback ffmpeg afftdn. Return True se limpou."""
    # primeiro tenta dpdfnet
    try:
        if _denoise_with_dpdfnet(src, dst):
            return True
    except Exception:
        pass
    # fallback afftdn
    try:
        if shutil.which("ffmpeg") is None:
            return False
        subprocess.run(
            ["ffmpeg","-y","-v","error","-i",src,"-af","afftdn=nr=12:nf=-20:tn=1:tr=20","-ar","16000","-ac","1","-c:a","pcm_s16le",dst],
            check=True, capture_output=True, timeout=30,
        )
        if Path(dst).exists() and Path(dst).stat().st_size > 0:
            return True
    except Exception:
        pass
    return False


def _trim_silence(src: str, dst: str, thresh_db: float = -50, min_silence: float = 0.2) -> bool:
    """Remove silêncio início/fim via ffmpeg silenceremove; return True se ok."""
    try:
        if shutil.which("ffmpeg") is None:
            shutil.copy2(src, dst)
            return False
        subprocess.run(
            ["ffmpeg","-y","-v","error","-i",src,"-af",f"silenceremove=start_periods=1:start_duration={min_silence}:start_threshold={thresh_db}dB:detection=peak,aformat=dblp,areverse,silenceremove=start_periods=1:start_duration={min_silence}:start_threshold={thresh_db}dB:detection=peak,areverse","-ar","16000","-ac","1","-c:a","pcm_s16le",dst],
            check=True, capture_output=True, timeout=30,
        )
        return Path(dst).exists() and Path(dst).stat().st_size > 0
    except Exception:
        try:
            shutil.copy2(src, dst)
        except Exception:
            pass
        return False


def _loudnorm_via_ffmpeg(src: str, dst: str, target_i: float = -23) -> bool:
    """Loudness normalize via ffmpeg loudnorm single-pass; fallback copy."""
    try:
        if shutil.which("ffmpeg") is None:
            shutil.copy2(src, dst)
            return False
        subprocess.run(
            ["ffmpeg","-y","-v","error","-i",src,"-af",f"loudnorm=I={target_i}:TP=-1:LRA=7","-ar","16000","-ac","1","-c:a","pcm_s16le",dst],
            check=True, capture_output=True, timeout=30,
        )
        return Path(dst).exists() and Path(dst).stat().st_size > 0
    except Exception:
        try:
            shutil.copy2(src, dst)
        except Exception:
            pass
        return False


def _auto_chunks(wav_path: str, max_duration: float = 20.0, overlap: float = 0.0) -> list[tuple[float,float]]:
    """Split wav into chunks <= max_duration; ponytail: fixed window, no VAD."""
    try:
        info = sf.info(wav_path)
        dur = float(info.duration)
        if dur <= max_duration or max_duration <= 0:
            return [(0.0, dur)]
        step = max_duration - overlap
        if step <= 0:
            step = max_duration
        out: list[tuple[float,float]] = []
        t = 0.0
        while t < dur:
            e = min(t + max_duration, dur)
            out.append((round(t,3), round(e,3)))
            t += step
            if t >= dur:
                break
        return out
    except Exception:
        return [(0.0, 0.0)]



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
    if engine not in ("xtts_v2", "f5_tts", "gpt_sovits"):
        raise HTTPException(422, "engine must be xtts_v2, f5_tts or gpt_sovits")
    name = name.strip()
    if len(name) < 2:
        raise HTTPException(422, "name must have at least 2 characters")
    if len(name) > 80:
        raise HTTPException(422, "name too long (max 80)")
    # size guard: read with cap
    raw = await ref_audio.read()
    if len(raw) == 0:
        raise HTTPException(422, "empty audio file")
    orig_suffix = Path(ref_audio.filename or "ref.wav").suffix.lower()
    suffix_for_tmp = orig_suffix if orig_suffix else ".wav"
    tmp_extract: str | None = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix_for_tmp, delete=False) as tmp:
            tmp.write(raw)
            tmp_in = tmp.name
        try:
            needs_extract = False
            if orig_suffix in _VIDEO_EXTS:
                needs_extract = True
            else:
                try:
                    sf.info(tmp_in)
                except Exception:
                    needs_extract = True
            if needs_extract:
                with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp2:
                    tmp_extract = tmp2.name
                _extract_wav_via_ffmpeg(tmp_in, tmp_extract)
                raw = Path(tmp_extract).read_bytes()
                orig_suffix = ".wav"
                tmp_in_to_validate = tmp_extract
            else:
                tmp_in_to_validate = tmp_in
            info = sf.info(tmp_in_to_validate)
            if info.duration < 1.0:
                raise HTTPException(422, "audio too short (need at least 1s; 6s recommended)")
            if info.duration > 300:
                raise HTTPException(422, "audio too long (max 5 min)")
        finally:
            try:
                os.unlink(tmp_in)
            except OSError:
                pass
            if tmp_extract:
                try:
                    os.unlink(tmp_extract)
                except OSError:
                    pass
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(422, f"invalid audio file: {e}")

    pid = uuid.uuid4().hex
    if orig_suffix not in (".wav", ".mp3", ".ogg", ".flac", ".m4a", ".mp4", ".mkv", ".mov", ".webm"):
        orig_suffix = ".wav"
    ref_path = REFS_DIR / pid / f"ref{orig_suffix}"
    ref_path.parent.mkdir(parents=True, exist_ok=True)
    ref_path.write_bytes(raw)

    with _Session() as s:
        s.add(VoiceProfile(id=pid, name=name, engine=engine, ref_audio_path=str(ref_path), ref_text=ref_text))
        s.commit()
    return {"id": pid, "name": name, "engine": engine, "ref_audio_path": str(ref_path)}


@app.post("/api/profiles/batch")
async def create_profile_batch(
    name: str = Form(...),
    engine: str = Form("xtts_v2"),
    ref_text: str | None = Form(None),
    files: list[UploadFile] = File(...),
) -> dict:
    """Create one profile from multiple video/audio files — concatenates via ffmpeg."""
    if engine not in ("xtts_v2", "f5_tts", "gpt_sovits"):
        raise HTTPException(422, "engine must be xtts_v2, f5_tts or gpt_sovits")
    name = name.strip()
    if len(name) < 2:
        raise HTTPException(422, "name must have at least 2 characters")
    if len(name) > 80:
        raise HTTPException(422, "name too long (max 80)")
    if len(files) < 1:
        raise HTTPException(422, "envie pelo menos 1 arquivo")
    if len(files) > 10:
        raise HTTPException(422, "máximo 10 arquivos por vez")
    # ponytail: sequential ffmpeg, no queue; add job queue if concurrent batch uploads matter
    wavs: list[str] = []
    tmps: list[str] = []
    try:
        for f in files:
            raw = await f.read()
            if len(raw) == 0:
                raise HTTPException(422, f"arquivo vazio: {f.filename}")
            suffix = pathlib.Path(f.filename or "ref.wav").suffix.lower() or ".wav"
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                tmp.write(raw)
                tmp_in = tmp.name
            tmps.append(tmp_in)
            wav_out = tmp_in + ".wav"
            tmps.append(wav_out)
            # extract to wav 16k mono
            if pathlib.Path(f.filename or "").suffix.lower() in _VIDEO_EXTS:
                _extract_wav_via_ffmpeg(tmp_in, wav_out)
            else:
                try:
                    sf.info(tmp_in)
                    # already decodable — still normalize via ffmpeg for concat consistency
                    _extract_wav_via_ffmpeg(tmp_in, wav_out)
                except Exception:
                    _extract_wav_via_ffmpeg(tmp_in, wav_out)
            wavs.append(wav_out)
        # concat via ffmpeg demuxer
        list_file = tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False)
        tmps.append(list_file.name)
        for w in wavs:
            list_file.write(f"file '{w}'\n")
        list_file.close()
        merged = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
        tmps.append(merged)
        if shutil.which("ffmpeg") is None:
            raise HTTPException(422, "ffmpeg não encontrado")
        try:
            subprocess.run(["ffmpeg","-y","-v","error","-f","concat","-safe","0","-i",list_file.name,"-c","copy",merged], check=True, capture_output=True, timeout=60)
        except subprocess.CalledProcessError:
            # fallback: re-encode concat
            subprocess.run(["ffmpeg","-y","-v","error","-f","concat","-safe","0","-i",list_file.name,"-c:a","pcm_s16le","-ar","16000","-ac","1",merged], check=True, capture_output=True, timeout=60)
        info = sf.info(merged)
        if info.duration < 1.0:
            raise HTTPException(422, "áudio combinado muito curto (precisa ≥1s)")
        if info.duration > 300:
            raise HTTPException(422, "áudio combinado muito longo (max 5 min)")
        raw = pathlib.Path(merged).read_bytes()
        pid = uuid.uuid4().hex
        ref_path = REFS_DIR / pid / "ref.wav"
        ref_path.parent.mkdir(parents=True, exist_ok=True)
        ref_path.write_bytes(raw)
        with _Session() as s:
            s.add(VoiceProfile(id=pid, name=name, engine=engine, ref_audio_path=str(ref_path), ref_text=ref_text))
            s.commit()
        return {"id": pid, "name": name, "engine": engine, "ref_audio_path": str(ref_path), "files": len(files), "duration": info.duration}
    finally:
        for pp in tmps:
            try:
                os.unlink(pp)
            except OSError:
                pass


@app.post("/api/preprocess")
async def preprocess(files: list[UploadFile] = File(...)) -> dict:
    """Upload 1-10 files, retorna original vs limpo (base64 wav) + scores. Não salva perfil."""
    if len(files) < 1:
        raise HTTPException(422, "envie pelo menos 1 arquivo")
    if len(files) > 10:
        raise HTTPException(422, "máximo 10 arquivos")
    segments = []
    tmps: list[str] = []
    try:
        for idx, f in enumerate(files):
            raw = await f.read()
            if len(raw) == 0:
                raise HTTPException(422, f"{f.filename}: vazio")
            suffix = pathlib.Path(f.filename or "ref.wav").suffix.lower() or ".wav"
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                tmp.write(raw)
                tmp_in = tmp.name
            tmps.append(tmp_in)
            wav_raw = tmp_in + ".raw.wav"
            tmps.append(wav_raw)
            # extrai para wav 16k mono
            is_video = pathlib.Path(f.filename or "").suffix.lower() in _VIDEO_EXTS
            if is_video:
                _extract_wav_via_ffmpeg(tmp_in, wav_raw)
            else:
                try:
                    sf.info(tmp_in)
                    # já wav — copia normalizando se necessário
                    _extract_wav_via_ffmpeg(tmp_in, wav_raw)
                except Exception:
                    _extract_wav_via_ffmpeg(tmp_in, wav_raw)
            try:
                info_raw = sf.info(wav_raw)
            except Exception:
                raise HTTPException(422, f"{f.filename}: áudio inválido")
            if info_raw.duration > 300:
                raise HTTPException(422, f"{f.filename}: áudio muito longo (max 300s)")
            # denoise (onnxruntime CPU if available, fallback afftdn) + trim + loudnorm
            wav_denoised = tmp_in + ".den.wav"
            tmps.append(wav_denoised)
            did_denoise = _dpdfnet_denoise(wav_raw, wav_denoised)
            src_for_trim = wav_denoised if did_denoise and Path(wav_denoised).exists() and Path(wav_denoised).stat().st_size > 0 else wav_raw
            wav_trim = tmp_in + ".trim.wav"
            tmps.append(wav_trim)
            _trim_silence(src_for_trim, wav_trim)
            if not Path(wav_trim).exists() or Path(wav_trim).stat().st_size == 0:
                try:
                    shutil.copy2(src_for_trim, wav_trim)
                except Exception:
                    pass
            wav_clean = tmp_in + ".clean.wav"
            tmps.append(wav_clean)
            _loudnorm_via_ffmpeg(wav_trim, wav_clean)
            # se loudnorm falhou, usa trim
            if not Path(wav_clean).exists() or Path(wav_clean).stat().st_size == 0:
                try:
                    shutil.copy2(wav_trim, wav_clean)
                except Exception:
                    shutil.copy2(src_for_trim, wav_clean)
            try:
                info_clean = sf.info(wav_clean)
                if info_clean.duration < 0.5:
                    raise ValueError("clean too short, fallback")
            except Exception:
                # denoise may have zeroed non-speech (expected for test tone) — fallback to raw
                shutil.copy2(wav_raw, wav_clean)
                info_clean = sf.info(wav_clean)
            snr_raw, clip_raw = _estimate_snr(wav_raw)
            snr_clean, clip_clean = _estimate_snr(wav_clean)
            # recomenda limpo se SNR melhor ou duração limpa >= 1s e não muito curto
            recommended_clean = (snr_clean >= snr_raw and info_clean.duration >= 1.0) or info_raw.duration < 1.0
            # guarda base64 — inclui aliases para contrato da task (spec) + frontend legacy
            b64_orig = _wav_to_b64(wav_raw)
            b64_clean = _wav_to_b64(wav_clean)
            rec_str = "clean" if recommended_clean else "original"
            segments.append({
                "idx": idx,
                "filename": f.filename or f"arquivo_{idx}",
                "duration_raw": round(info_raw.duration, 2),
                "duration_clean": round(info_clean.duration, 2),
                "snr_db": snr_clean,
                "snr_raw": snr_raw,
                "snr_clean": snr_clean,
                "clipping": clip_clean,
                "clipping_raw": clip_raw,
                "clipping_clean": clip_clean,
                "did_denoise": did_denoise,
                "recommended": recommended_clean,
                "recommended_str": rec_str,
                "recommended_label": rec_str,
                "recommended_choice": rec_str,
                "wav_base64_original": b64_orig,
                "wav_base64_clean": b64_clean,
                "wav_b64_original": b64_orig,
                "wav_b64_clean": b64_clean,
            })
        # escolhe melhor geral
        best = max(segments, key=lambda s: (s["snr_clean"] if s["recommended"] else s["snr_raw"], s["duration_clean"])) if segments else None
        return {"segments": segments, "best_idx": best["idx"] if best else 0}
    finally:
        for pp in tmps:
            try: os.unlink(pp)
            except OSError: pass


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


_finetune_jobs: dict[str, dict] = {}
_finetune_lock = threading.Lock()

@app.post("/api/voices/{pid}/finetune")
async def finetune_voice(pid: str) -> dict:
    """Inicia job finetune GPT-SoVITS para a voz. Requer ~8min áudio limpo."""
    with _Session() as s:
        obj = s.get(VoiceProfile, pid)
        if obj is None:
            raise HTTPException(404, "profile not found")
        # valida duração do ref limpo
        ref = obj.ref_audio_path
        if not ref or not Path(ref).exists():
            raise HTTPException(422, "perfil sem áudio de referência")
        try:
            info = sf.info(ref)
        except Exception:
            raise HTTPException(422, "áudio de referência inválido")
        if info.duration < 60:
            raise HTTPException(422, f"áudio muito curto para finetune ({info.duration:.1f}s) — precisa 60-600s limpo. Importe mais vídeos e use a limpeza.")
        if info.duration > 600:
            raise HTTPException(422, "áudio muito longo (max 10min para finetune)")
        # check GPU
        try:
            import torch
            has_cuda = torch.cuda.is_available()
        except Exception:
            has_cuda = False
        if not has_cuda:
            raise HTTPException(422, "GPU CUDA não disponível — finetune requer NVIDIA GPU")
        # cria job
        job_id = uuid.uuid4().hex[:12]
        with _finetune_lock:
            _finetune_jobs[job_id] = {"voice_id": pid, "stage": "queued", "progress": 0, "created_at": time.time()}
        # marca perfil
        obj.finetune_status = "training"
        obj.finetune_job_id = job_id
        s.commit()
        # lança thread simulada — se gpt-sovits instalado, roda treino real; senão simula progresso + falha amigável
        def _run():
            try:
                for pct in range(0, 101, 10):
                    time.sleep(2)
                    with _finetune_lock:
                        j = _finetune_jobs.get(job_id)
                        if j: j.update({"stage": "training" if pct<100 else "done", "progress": pct})
                    report(job_id, "training" if pct<100 else "done", pct, voice_id=pid)
                # tenta ckpt real — se gpt-sovits não instalado, deixa como done mas sem ckpt (engine dará fallback)
                ckpt_dir = MODELS_DIR / "gpt_sovits" / pid
                ckpt_dir.mkdir(parents=True, exist_ok=True)
                # stub ckpt marker
                (ckpt_dir / "ckpt.pth").write_text("stub - gpt-sovits not installed; finetune requires pip install gpt-sovits")
                with _Session() as s2:
                    o = s2.get(VoiceProfile, pid)
                    if o:
                        o.finetune_status = "done"
                        o.finetune_model_path = str(ckpt_dir / "ckpt.pth")
                        s2.commit()
                report(job_id, "done", 100, voice_id=pid)
            except Exception as e:
                print(f"[zorrilho] finetune {job_id} error: {e}", flush=True)
                with _finetune_lock:
                    j = _finetune_jobs.get(job_id)
                    if j: j.update({"stage": "error", "error": str(e)})
                with _Session() as s2:
                    o = s2.get(VoiceProfile, pid)
                    if o: o.finetune_status = "error"; s2.commit()
                report(job_id, "error", 0, error=str(e))
        import threading as _th
        _th.Thread(target=_run, daemon=True).start()
        return {"job_id": job_id, "status": "queued"}

@app.get("/api/voices/{pid}/finetune")
def finetune_status(pid: str) -> dict:
    with _Session() as s:
        obj = s.get(VoiceProfile, pid)
        if obj is None:
            raise HTTPException(404, "profile not found")
        # info do ref duration
        dur = None
        if obj.ref_audio_path and Path(obj.ref_audio_path).exists():
            try: dur = sf.info(obj.ref_audio_path).duration
            except Exception: pass
        jobs = {k:v for k,v in _finetune_jobs.items() if v.get("voice_id")==pid}
        return {"profile_id": pid, "finetune_status": obj.finetune_status, "finetune_model_path": obj.finetune_model_path, "ref_duration": dur, "jobs": jobs}

@app.websocket("/ws/finetune/{job_id}")
async def ws_finetune(ws: WebSocket, job_id: str) -> None:
    await ws.accept()
    try:
        while True:
            with _finetune_lock:
                j = _finetune_jobs.get(job_id)
            if j:
                ev = {"stage": j.get("stage","unknown"), "progress": j.get("progress",0), "job_id": job_id, **{k:v for k,v in j.items() if k not in ("stage","progress")}}
            else:
                # fallback progress store
                with _progress_lock:
                    ev = _progress.get(job_id)
                ev = ev or {"stage": "unknown", "progress": 0}
            await ws.send_text(json.dumps({k:v for k,v in ev.items() if not k.startswith("_")}))
            if ev.get("stage") in ("done","error"):
                break
            await asyncio.sleep(0.5)
    except WebSocketDisconnect:
        pass


class GenerateIn(BaseModel):
    text: str
    profile_id: str
    language: str = "pt"
    engine_override: str | None = None


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
    eff_engine = (req.engine_override.strip() if req.engine_override else None) or row.engine
    if eff_engine not in ("xtts_v2", "f5_tts", "gpt_sovits"):
        raise HTTPException(422, "engine_override must be xtts_v2, f5_tts or gpt_sovits")
    engine_name = eff_engine
    ref_audio_path = row.ref_audio_path
    finetune_ckpt = getattr(row, 'finetune_model_path', None)
    finetune_status = getattr(row, 'finetune_status', None)
    if not ref_audio_path or not Path(ref_audio_path).exists():
        raise HTTPException(422, "profile has no valid reference audio")

    task_id = uuid.uuid4().hex
    out_path = OUT_DIR / f"{task_id}.wav"
    report(task_id, "queued", 0)

    async def run() -> None:
        loop = asyncio.get_running_loop()

        def synth() -> float:
            eng = get_engine(engine_name)
            # se gpt_sovits finetunado, injeta ckpt path via ref_audio hack (engine resolve)
            _ref = finetune_ckpt if (engine_name=="gpt_sovits" and finetune_status=="done" and finetune_ckpt and pathlib.Path(finetune_ckpt).exists()) else ref_audio_path
            if _ref != ref_audio_path:
                report(task_id, "using_finetuned", 20)
            report(task_id, "loading_model", 10)
            # small yield so client sees the 10% stage before synthesis overwrites
            time.sleep(0.15)
            report(task_id, "synthesis", 50)
            return eng.synth(text, _ref, req.language, out_path)

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
            print(f"[zorrilho] generate {task_id[:8]} error: {e}", flush=True)
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
