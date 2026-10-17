"""Offline smoke: API validation without GPU. Run from repo root:
    sidecar/.venv/bin/python tests/smoke_sidecar.py
or
    (cd sidecar && ../sidecar/.venv/bin/python ../tests/smoke_sidecar.py)
"""
import os, tempfile, pathlib, math, sys

# isolate DB
tmpdir = str(pathlib.Path(tempfile.mkdtemp(prefix="zorrilho-smoke-")))
os.environ["ZORRILHO_DATA_DIR"] = tmpdir

# sidecar package lives at sidecar/zorrilho
REPO = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "sidecar"))

import zorrilho.config as cfg  # noqa: E402
cfg.DATA_DIR = pathlib.Path(tmpdir)
cfg.DB_PATH = cfg.DATA_DIR / "zorrilho.db"
cfg.REFS_DIR = cfg.DATA_DIR / "refs"
cfg.OUT_DIR = cfg.DATA_DIR / "out"
cfg.HUSHMIC_DIR = cfg.DATA_DIR / "models/hushmic"

import importlib, zorrilho.main as mainmod  # noqa: E402
importlib.reload(mainmod)
mainmod.init_db()

from fastapi.testclient import TestClient  # noqa: E402
from pathlib import Path  # noqa: E402
import soundfile as sf  # noqa: E402

client = TestClient(mainmod.app)

def ok(msg): print(f"✓ {msg}")

r = client.get("/health")
assert r.status_code == 200 and r.json()["status"] == "ok", r.text
ok("GET /health")
r = client.post("/api/profiles", data={"name": "x"}, files={"ref_audio": ("ref.wav", b"xx", "audio/wav")})
assert r.status_code == 422
ok("POST short name 422")
r = client.post("/api/profiles", data={"name": "AB"}, files={"ref_audio": ("ref.wav", b"\x00\x01", "audio/wav")})
assert r.status_code == 422
ok("POST invalid audio 422")
sr = 16000
samples = [0.3 * math.sin(2 * math.pi * 440 * i / sr) for i in range(int(sr * 1.2))]
tmpf = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
tmpf.close()
sf.write(tmpf.name, samples, sr)
raw = Path(tmpf.name).read_bytes()
r = client.post("/api/profiles", data={"name": "Valid", "engine": "xtts_v2"}, files={"ref_audio": ("ref.wav", raw, "audio/wav")})
assert r.status_code == 200, r.text
pid = r.json()["id"]
ok(f"POST valid audio → {pid}")
r = client.get("/api/profiles")
assert any(p["id"] == pid for p in r.json())
ok("GET /api/profiles")
r = client.post("/api/generate", json={"text": "a" * 9000, "profile_id": pid, "language": "pt"})
assert r.status_code == 422
r = client.post("/api/generate", json={"text": "   ", "profile_id": pid, "language": "pt"})
assert r.status_code == 422
ok("POST /api/generate text validation 422")
r = client.post("/api/generate", json={"text": "ola", "profile_id": "nope", "language": "pt"})
assert r.status_code == 404
ok("POST unknown profile 404")
r = client.delete(f"/api/profiles/{pid}")
assert r.status_code == 200
ok("DELETE profile")
r = client.delete(f"/api/profiles/{pid}")
assert r.status_code == 404
ok("DELETE 404 after")
r = client.get("/api/generations/xxx/export?format=wav")
assert r.status_code == 404
r = client.get("/api/generations/xxx/export?format=png")
assert r.status_code == 422
ok("export validation 404/422")
print("ALL PASS (10 checks) — tmp:", tmpdir)
