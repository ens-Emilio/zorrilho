"""Engine registry.
 xtts_v2    — Coqui XTTS v2 zero-shot (default)
 f5_tts     — F5-TTS / E2-TTS zero-shot (opcional, pip install f5-tts)
 gpt_sovits — GPT-SoVITS v3 fine-tune (stub, futuro)
"""

from __future__ import annotations

import os
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
    """F5-TTS zero-shot via subprocess num venv dedicado.

    coqui-tts (XTTS) pina numpy<2 enquanto o f5-tts (via datasets/pyarrow)
    exige numpy>=2 — não coexistem. Então o F5 roda num venv separado
    (sidecar/.venv-f5) e este engine despacha um CLI. Ponytail: subprocess
    por sílaba única de isolamento; se um dia houver só XTTS, remover.
    """

    def _venv_python(self) -> str | None:
        # lado a lado do repo: sidecar/.venv-f5
        here = Path(__file__).resolve()
        candidates = [
            here.parent.parent / ".venv-f5" / "bin" / "python",
            here.parent.parent / ".venv-f5" / "Scripts" / "python.exe",
        ]
        for c in candidates:
            if c.exists():
                return str(c)
        return None

    def synth(self, text: str, ref_audio: str, language: str, out_path: Path) -> float:
        import subprocess
        import time

        py = self._venv_python()
        if py is None:
            raise RuntimeError(
                "f5_tts não configurado. Rode: ./scripts/setup-f5.sh "
                "(cria sidecar/.venv-f5 com numpy>=2 e baixa o modelo ~1.3GB)"
            )
        t0 = time.monotonic()
        cli = Path(__file__).resolve().parent / "f5_cli.py"
        proc = subprocess.run(
            [py, str(cli), ref_audio, text, language, str(out_path)],
            capture_output=True,
            text=True,
            timeout=600,
        )
        if proc.returncode != 0:
            raise RuntimeError(f"f5_tts falhou (rc={proc.returncode}): {proc.stderr.strip()}")
        return time.monotonic() - t0


class GptSovitsEngine:
    """GPT-SoVITS finetunado: infere via inference_cli.py do repo (GPT+SoVITS ckpts).

    Recebe em `ref_audio` o path do ckpt SoVITS (*sovits* ou ckpt.pth) escolhido
    pelo main.py; o GPT ckpt é buscado ao lado (mesmo diretório, G_*.pth/.ckpt).
    """

    def synth(self, text: str, ref_audio: str, language: str, out_path: Path) -> float:
        import subprocess
        import tempfile
        import time

        from zorrilho.main import _gpt_sovits_repo

        repo = _gpt_sovits_repo()
        if repo is None:
            raise RuntimeError(
                "GPT-SoVITS não instalado — use xtts_v2/f5_tts ou rode scripts/setup-gpt-sovits.sh"
            )
        sovits = Path(ref_audio)
        if not sovits.is_file():
            raise RuntimeError(f"ckpt SoVITS inválido: {ref_audio}")
        # GPT ckpt: procura .ckpt/.pth irmão que NÃO seja o SoVITS (G_/eN.ckpt)
        gpt = next(
            (p for p in sorted(sovits.parent.glob("*.ckpt")) if "s1" not in p.name.lower()),
            None,
        )
        if gpt is None:
            gpt = next((p for p in sorted(sovits.parent.glob("G_*.pth"))), None)
        if gpt is None:
            raise RuntimeError(
                f"ckpt GPT não encontrado ao lado de {sovits.name} (esperado G_*.pth ou *.ckpt)"
            )

        py = str(next((p for p in repo.rglob("bin/python") if p.exists()), "python"))
        t0 = time.monotonic()
        with tempfile.TemporaryDirectory() as td:
            ref_txt = Path(td) / "ref.txt"
            src_txt = Path(td) / "src.txt"
            ref_txt.write_text(os.path.splitext(Path(ref_audio).name)[0], encoding="utf-8")
            src_txt.write_text(text, encoding="utf-8")
            cmd = [
                py, "-s", str(repo / "GPT_SoVITS" / "inference_cli.py"),
                "--gpt_model", str(gpt),
                "--sovits_model", str(sovits),
                "--ref_audio", ref_audio,
                "--ref_text", str(ref_txt),
                "--ref_language", language,
                "--target_text", str(src_txt),
                "--target_language", language,
                "--output_path", td,
            ]
            proc = subprocess.run(cmd, capture_output=True, text=True,
                                  cwd=str(repo), timeout=600)
            if proc.returncode != 0:
                raise RuntimeError(f"gpt_sovits infer falhou: {proc.stderr.strip()[-400:]}")
            generated = Path(td) / "output.wav"
            if not generated.exists():
                raise RuntimeError("gpt_sovits: inferência não gerou output.wav")
            out_path.write_bytes(generated.read_bytes())
        return time.monotonic() - t0


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
