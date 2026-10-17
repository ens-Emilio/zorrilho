"""Lazy download of HushMic (DPDFNet) assets and model verification.

- .onnx: via pip `dpdfnet` ( dpdfnet download <model> ), cache ~/.cache/dpdfnet/models
- .weights.f32: from DPDFNet repo (pinned commit), SHA-256 verified
- XTTS v2: Coqui downloads on first generation (TTS_HOME) — nothing to do
"""

from __future__ import annotations

import hashlib
import subprocess
import sys
import urllib.request
from pathlib import Path

from zorrilho.config import HUSHMIC_DIR, MAX_REF_BYTES  # noqa: F401 — re-export for config centralization

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
    """Download missing HushMic assets. Returns list of actions taken."""
    HUSHMIC_DIR.mkdir(parents=True, exist_ok=True)
    actions: list[str] = []

    # 1. ONNX via dpdfnet
    onnx = onnx_path()
    if not (onnx.exists() and sha256(onnx) == ONNX_SHA256):
        try:
            subprocess.run(
                [sys.executable, "-m", "dpdfnet", "download", MODEL],
                check=True,
                capture_output=True,
                timeout=300,
            )
        except FileNotFoundError as e:
            raise RuntimeError(f"dpdfnet not available: {e}")
        except subprocess.TimeoutExpired:
            raise RuntimeError("dpdfnet download timed out (300s)")
        cache = Path.home() / ".cache/dpdfnet/models" / f"{MODEL}.onnx"
        if not cache.exists():
            raise RuntimeError("dpdfnet did not produce model (empty cache)")
        got = sha256(cache)
        if got != ONNX_SHA256:
            raise RuntimeError(f"sha256 mismatch on onnx: {got}")
        onnx.write_bytes(cache.read_bytes())
        actions.append(f"downloaded {MODEL}.onnx")
        if progress_cb:
            progress_cb(1, 2, f"{MODEL}.onnx")
    elif progress_cb:
        progress_cb(1, 2, f"{MODEL}.onnx")

    # 2. weights from DPDFNet repo (pinned commit) — with retry
    weights = weights_path()
    if not (weights.exists() and sha256(weights) == WEIGHTS_SHA256):
        url = f"{DPDFNET_NATIVE_URL}/{MODEL}/weights.f32"
        tmp = weights.with_suffix(".tmp")
        last_err: Exception | None = None
        for attempt in range(3):
            try:
                with urllib.request.urlopen(url, timeout=60) as resp, tmp.open("wb") as f:
                    while True:
                        chunk = resp.read(1 << 16)
                        if not chunk:
                            break
                        f.write(chunk)
                break
            except Exception as e:
                last_err = e
                if attempt == 2:
                    tmp.unlink(missing_ok=True)
                    raise RuntimeError(f"failed to download weights after 3 attempts: {last_err}") from last_err
        got = sha256(tmp)
        if got != WEIGHTS_SHA256:
            tmp.unlink(missing_ok=True)
            raise RuntimeError(f"sha256 mismatch on weights: {got}")
        tmp.rename(weights)
        actions.append(f"downloaded {MODEL}.weights.f32")
        if progress_cb:
            progress_cb(2, 2, f"{MODEL}.weights.f32")
    elif progress_cb:
        progress_cb(2, 2, f"{MODEL}.weights.f32")

    return actions


if __name__ == "__main__":
    for a in ensure_hushmic_assets(lambda d, t, n: print(f"[{d}/{t}] {n} ok")):
        print(a)
    print("hushmic assets ready:", assets_ok())
