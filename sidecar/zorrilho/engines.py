"""Engine registry: seleciona o motor de TTS pelo nome do perfil.

 xtts_v2   — zero-shot, sempre disponível ( modelo baixado no 1º uso )
 gpt_sovits — fine-tuning de alta fidelidade ( implementação futura )
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Protocol

import os

DATA_DIR = Path(os.environ.get("ZORRILHO_DATA_DIR", Path.home() / ".local/share/zorrilho"))
MODELS_DIR = DATA_DIR / "models"


class SynthEngine(Protocol):
    def synth(self, text: str, ref_audio: str, language: str, out_path: Path) -> float:
        """Gera áudio; retorna segundos decorridos."""
        ...


@dataclass
class XttsV2Engine:
    """Zero-shot Coqui XTTS v2."""

    _tts = None  # loaded lazily

    def synth(self, text: str, ref_audio: str, language: str, out_path: Path) -> float:
        import time
        from TTS.api import TTS

        t0 = time.monotonic()
        if XttsV2Engine._tts is None:
            XttsV2Engine._tts = TTS(model_name="tts_models/multilingual/multi-dataset/xtts_v2", gpu=True)
        XttsV2Engine._tts.tts_to_file(
            text=text, speaker_wav=ref_audio, language=language, file_path=str(out_path)
        )
        return time.monotonic() - t0


class GptSovitsEngine:
    """Placeholder: fine-tuning de alta fidelidade.

    Implementação futura: chamada a scripts GPT-SoVITS via subprocess.
    """

    def synth(self, text: str, ref_audio: str, language: str, out_path: Path) -> float:
        raise NotImplementedError("gpt_sovits: ainda não implementado")


ENGINES: dict[str, type[SynthEngine]] = {
    "xtts_v2": XttsV2Engine,
    "gpt_sovits": GptSovitsEngine,
}


def get_engine(name: str) -> SynthEngine:
    cls = ENGINES.get(name)
    if cls is None:
        raise ValueError(f"engine desconhecida: {name}")
    return cls()
