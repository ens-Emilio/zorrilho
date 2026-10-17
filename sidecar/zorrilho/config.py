"""Central paths and env for the sidecar. Single source of truth for DATA_DIR."""

from __future__ import annotations

import os
from pathlib import Path

DATA_DIR = Path(os.environ.get("ZORRILHO_DATA_DIR", Path.home() / ".local/share/zorrilho"))
DB_PATH = DATA_DIR / "zorrilho.db"
REFS_DIR = DATA_DIR / "refs"
OUT_DIR = DATA_DIR / "out"
MODELS_DIR = DATA_DIR / "models"
HUSHMIC_DIR = MODELS_DIR / "hushmic"
HF_DIR = DATA_DIR / "hf"

# Sidecar port (env overrides config)
PORT = int(os.environ.get("PORT", "8765"))

# Max ref upload (20 MiB)
MAX_REF_BYTES = 20 * 1024 * 1024
