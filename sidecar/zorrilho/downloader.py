"""Download lazy dos assets HushMic (DPDFNet) e verificação de modelos.

- .onnx: via pacote pip `dpdfnet` ( dpdfnet download <model> ), cache ~/.cache/dpdfnet/models
- .weights.f32: do repo DPDFNet ( commit pinado ), verificado por sha256
- XTTS v2: o próprio Coqui baixa na primeira geracao ( TTS_HOME ) — nada a fazer
"""

from __future__ import annotations

import hashlib
import subprocess
import sys
import urllib.request
from pathlib import Path

import os

DATA_DIR = Path(os.environ.get("ZORRILHO_DATA_DIR", Path.home() / ".local/share/zorrilho"))
HUSHMIC_DIR = DATA_DIR / "models/hushmic"

DPDFNET_NATIVE_URL = (
    "https://raw.githubusercontent.com/ceva-ip/DPDFNet/"
    "6a5dbd3ea5dbea88c30a2be8e7c689b5eb26b533/native_inference/artifacts/v1"
)

ONNX_SHA256 = "7b3afbb260a08fe9af3d16e3bda992971be1e7e951d1dee7c2d235f5c43f5631"
WEIGHTS_SHA256 = "5a5bb67a8619090c54dc2793536fe813fe38123b236d445f3433aafe3075529d"

MODEL = "dpdfnet8_48khz_hr"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def onnx_path() -> Path:
    return HUSHMIC_DIR / f"{MODEL}.onnx"


def weights_path() -> Path:
    return HUSHMIC_DIR / f"{MODEL}.weights.f32"


def assets_ok() -> bool:
    onnx, weights = onnx_path(), weights_path()
    return (
        onnx.exists() and sha256(onnx) == ONNX_SHA256
        and weights.exists() and sha256(weights) == WEIGHTS_SHA256
    )


def ensure_hushmic_assets(progress_cb=None) -> list[str]:
    """Baixa os assets HushMic faltantes. Retorna lista de acoes realizadas."""
    HUSHMIC_DIR.mkdir(parents=True, exist_ok=True)
    actions: list[str] = []

    # 1. ONNX via dpdfnet
    onnx = onnx_path()
    if not (onnx.exists() and sha256(onnx) == ONNX_SHA256):
        subprocess.run(
            [sys.executable, "-m", "dpdfnet", "download", MODEL],
            check=True,
            capture_output=True,
        )
        cache = Path.home() / ".cache/dpdfnet/models" / f"{MODEL}.onnx"
        if not cache.exists():
            raise RuntimeError("dpdfnet nao baixou o modelo (cache vazio)")
        got = sha256(cache)
        if got != ONNX_SHA256:
            raise RuntimeError(f"sha256 mismatch no onnx: {got}")
        onnx.write_bytes(cache.read_bytes())
        actions.append(f"baixado {MODEL}.onnx")
        if progress_cb:
            progress_cb(1, 2, f"{MODEL}.onnx")
    elif progress_cb:
        progress_cb(1, 2, f"{MODEL}.onnx")

    # 2. weights do DPDFNet repo ( commit pinado )
    weights = weights_path()
    if not (weights.exists() and sha256(weights) == WEIGHTS_SHA256):
        url = f"{DPDFNET_NATIVE_URL}/{MODEL}/weights.f32"
        tmp = weights.with_suffix(".tmp")
        urllib.request.urlretrieve(url, tmp)
        got = sha256(tmp)
        if got != WEIGHTS_SHA256:
            tmp.unlink(missing_ok=True)
            raise RuntimeError(f"sha256 mismatch nos weights: {got}")
        tmp.rename(weights)
        actions.append(f"baixado {MODEL}.weights.f32")
        if progress_cb:
            progress_cb(2, 2, f"{MODEL}.weights.f32")
    elif progress_cb:
        progress_cb(2, 2, f"{MODEL}.weights.f32")

    return actions


if __name__ == "__main__":
    for a in ensure_hushmic_assets(lambda d, t, n: print(f"[{d}/{t}] {n} ok")):
        print(a)
    print("assets hushmic prontos:", assets_ok())
