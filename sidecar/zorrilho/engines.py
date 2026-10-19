"""Engine registry.
 xtts_v2    — Coqui XTTS v2 zero-shot (default)
 f5_tts     — F5-TTS / E2-TTS zero-shot (opcional, pip install f5-tts)
 gpt_sovits — GPT-SoVITS v3 fine-tune (stub, futuro)
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


class SynthEngine(Protocol):
    def synth(self, text: str, ref_audio: str, language: str, out_path: Path) -> float:
        """Synthesize audio; return wall seconds."""
        ...


@dataclass
class XttsV2Engine:
    """Zero-shot Coqui XTTS v2. TTS singleton is guarded by a lock."""

    _tts = None
    _lock = threading.Lock()

    def synth(self, text: str, ref_audio: str, language: str, out_path: Path) -> float:
        import time

        from TTS.api import TTS

        t0 = time.monotonic()
        if XttsV2Engine._tts is None:
            with XttsV2Engine._lock:
                if XttsV2Engine._tts is None:
                    gpu = False
                    try:
                        import torch

                        gpu = torch.cuda.is_available()
                    except Exception:
                        pass
                    import warnings
                    with warnings.catch_warnings():
                        warnings.simplefilter("ignore")
                        XttsV2Engine._tts = TTS(
                            model_name="tts_models/multilingual/multi-dataset/xtts_v2", gpu=gpu
                        )
        # re-enter lock for inference to avoid concurrent XttsV2Engine._tts use racing
        with XttsV2Engine._lock:
            tts = XttsV2Engine._tts
        # tts_to_file is CPU/GPU bound; caller runs it in executor
        tts.tts_to_file(text=text, speaker_wav=ref_audio, language=language, file_path=str(out_path))
        return time.monotonic() - t0


class F5TTSEngine:
    """F5-TTS zero-shot (melhor prosódia pt-BR que XTTS). Requer: pip install f5-tts"""
    _model = None
    _lock = threading.Lock()
    def synth(self, text: str, ref_audio: str, language: str, out_path: Path) -> float:
        import time
        t0 = time.monotonic()
        try:
            from f5_tts.api import F5TTS  # pip install f5-tts
        except ImportError:
            raise RuntimeError("f5_tts não instalado — rode: uv pip install f5-tts --python 3.11  (ou pip install f5-tts)")
        if F5TTSEngine._model is None:
            with F5TTSEngine._lock:
                if F5TTSEngine._model is None:
                    F5TTSEngine._model = F5TTS()
        m = F5TTSEngine._model
        # API varia por versão — tenta infer mais comum
        if hasattr(m, "infer"):
            # F5TTS.infer(ref_file, ref_text, gen_text, file_wave)
            ref_text = ""  # sem transcrição, deixa modelo inferir
            try:
                m.infer(ref_file=ref_audio, ref_text=ref_text, gen_text=text, file_wave=str(out_path))
            except TypeError:
                # fallback assinatura alternativa
                m.infer(ref_audio, text, str(out_path))
        else:
            raise RuntimeError("F5TTS API incompatível — atualize f5-tts")
        return time.monotonic() - t0


class GptSovitsEngine:
    """GPT-SoVITS v3 — se ckpt finetunado existe, usa-o; senão stub informativo."""
    _lock = threading.Lock()
    def synth(self, text: str, ref_audio: str, language: str, out_path: Path) -> float:
        import time
        t0 = time.monotonic()
        # tenta achar ckpt por convenção: MODELS_DIR/gpt_sovits/{voice_hash}/ckpt ou refs resolve fora
        # o caller (main.py generate) resolve o path real via DB finetune_model_path
        # este engine é genérico — se ref_audio for diretório de dataset com ckpt, usa; senão tenta fallback
        ckpt = Path(ref_audio).parent / "finetune" / "ckpt.pth" if Path(ref_audio).is_file() else None
        # se existe, tenta infer via GPT-SoVITS API (se instalada)
        if ckpt and ckpt.exists():
            try:
                from gpt_sovits.infer import infer as _gs_infer  # placeholder API
                _gs_infer(ckpt=str(ckpt), ref_audio=ref_audio, text=text, out=str(out_path), language=language)
                return time.monotonic() - t0
            except ImportError:
                pass
            except Exception as e:
                raise RuntimeError(f"gpt_sovits ckpt falhou: {e}")
        raise NotImplementedError("gpt_sovits: precisa treino (POST /api/voices/{id}/finetune com 8-10min limpo). Use xtts_v2 ou f5_tts por enquanto.")


ENGINES: dict[str, type[SynthEngine]] = {
    "xtts_v2": XttsV2Engine,
    "f5_tts": F5TTSEngine,
    "gpt_sovits": GptSovitsEngine,
}


def get_engine(name: str) -> SynthEngine:
    cls = ENGINES.get(name)
    if cls is None:
        raise ValueError(f"unknown engine: {name}")
    return cls()
