"""Engine registry: selects the TTS backend by profile name.

 xtts_v2    — zero-shot, always available (model downloaded on first use)
 gpt_sovits — high-fidelity fine-tuning (future)
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
                    XttsV2Engine._tts = TTS(
                        model_name="tts_models/multilingual/multi-dataset/xtts_v2", gpu=gpu
                    )
        # re-enter lock for inference to avoid concurrent XttsV2Engine._tts use racing
        with XttsV2Engine._lock:
            tts = XttsV2Engine._tts
        # tts_to_file is CPU/GPU bound; caller runs it in executor
        tts.tts_to_file(text=text, speaker_wav=ref_audio, language=language, file_path=str(out_path))
        return time.monotonic() - t0


class GptSovitsEngine:
    """Placeholder: high-fidelity fine-tuning via GPT-SoVITS scripts."""

    def synth(self, text: str, ref_audio: str, language: str, out_path: Path) -> float:
        raise NotImplementedError("gpt_sovits: not yet implemented")


ENGINES: dict[str, type[SynthEngine]] = {
    "xtts_v2": XttsV2Engine,
    "gpt_sovits": GptSovitsEngine,
}


def get_engine(name: str) -> SynthEngine:
    cls = ENGINES.get(name)
    if cls is None:
        raise ValueError(f"unknown engine: {name}")
    return cls()
