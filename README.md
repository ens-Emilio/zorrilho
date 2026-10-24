# 🦨 Zorrilho

> Local, offline voice cloning for Linux (Arch) — XTTS v2 + real-time microphone denoising (DPDFNet).

**Languages:** [English](README.md) · [Português (BR)](README.pt-BR.md) · [Español](README.es.md)

Zorrilho is a desktop app for cloning your own voice from a short reference sample (~6 s) and generating speech from any script — entirely on-device. No cloud, no account, no audio leaving the machine. It pairs [Coqui XTTS v2](https://coqui.ai) for zero-shot TTS with [HushMic](https://github.com/Fovty/hushmic) / [DPDFNet](https://github.com/ceva-ip/DPDFNet) for in-process noise suppression at capture time.

---

## Features

- **Zero-shot voice clone** — one 6 s+ sample, any language XTTS v2 supports (`pt`, `en`, `es`, …).
- **In-process denoising** — DPDFNet `native` engine (INT8, AVX2) via `hushmic-denoiser`; no PipeWire daemon required.
- **4-tab studio** — *Clone* (record / upload reference → create profile), *Studio* (script → generate), *Projects* (history + WAL player + WAV/MP3 export), *Settings* (health, asset download).
- **Real-time progress** — `POST /api/generate` returns `task_id`; `WS /ws/progress/{task_id}` streams stages.
- **Self-contained data** — everything under `~/.local/share/zorrilho/` (SQLite, refs, generations, models).
- **Lazy models** — XTTS v2 (~1.8 GB) and HushMic assets (~29 MB) download on first use, SHA-256 verified.
- **Arch-native packaging** — `makepkg -si` → `/usr/bin/zorrilho` + `/opt/zorrilho` + desktop entry; Python venv created on first run (no 2.5 GB CUDA blob in the pacman package).

## Architecture

```
┌─────────────────────────────────────────────┐
│  Tauri v2 shell (Rust)  — app/src-tauri/    │
│  React + TypeScript + Tailwind v4 — app/    │
│  audio::record_start/stop (cpal + hound)    │
│  hushmic-denoiser StreamDenoiser (native)   │
│  sidecar spawn + /health polling + shutdown │
└──────────────────┬──────────────────────────┘
                   │ HTTP + WebSocket (127.0.0.1:8765)
                   ▼
┌─────────────────────────────────────────────┐
│  Sidecar FastAPI — sidecar/zorrilho/        │
│  /health, /api/profiles, /api/generate,     │
│  /ws/progress/{id}, /api/generations,       │
│  /api/assets/ensure                         │
│  SQLAlchemy + SQLite  ·  engine registry     │
│  xtts_v2 (Coqui) · f5_tts · gpt_sovits (finetune)│
└─────────────────────────────────────────────┘
```

* Frontend dev proxy: `app/vite.config.ts` proxies `/api`, `/health`, `/ws` → `localhost:8765` so `vite dev` avoids CORS. In Tauri prod the app hits `http://localhost:8765` directly; WS URL is derived from the same base.

## Stack

| Layer | Tech |
|---|---|
| Desktop shell | Tauri v2 (Rust), `tauri-plugin-log` |
| UI | React 19 + TypeScript 6 + Vite 8 + Tailwind CSS v4, Zustand, Headless UI, Heroicons |
| Audio capture | `cpal` + `hound` + `hushmic-denoiser` (git, `native` feature) |
| Sidecar | FastAPI + Uvicorn + SQLAlchemy + Alembic + `python-multipart` + `soundfile` + `websockets` |
| TTS | `coqui-tts==0.25.3` (XTTS v2) · `f5-tts` (venv isolado `.venv-f5`) · GPT-SoVITS (finetune via repo + `setup-gpt-sovits.sh`) |
| Denoising assets | `dpdfnet==0.5.1` (ONNX) + `.weights.f32` from Ceva DPDFNet (pinned commit, SHA-256) |
| Packaging | `packaging/PKGBUILD` + `zorrilho-sidecar` wrapper (lazy `uv`/`pip` venv) + `zorrilho.desktop` |

## Requirements

- Arch Linux (or derivative), `webkit2gtk-4.1`, `gtk3`, `ffmpeg` (for MP3 export).
- For TTS: NVIDIA GPU + `nvidia-utils` recommended; CPU works but is slower. CUDA via `pip` `torch==2.5.0+cu128`.
- Build: `rust` ≥1.90, `nodejs` ≥20 + `npm`, `git`; sidecar dev: `uv` (or `python 3.11` + `pip`).

## Quick start (dev)

```bash
# 1) sidecar alone (optional — Tauri spawns it automatically)
cd sidecar
uv sync
uv run uvicorn zorrilho.main:app --port 8765 --host 127.0.0.1

# 2) desktop app (Vite + Tauri dev)
cd app
npm ci
npm run build        # sanity check
npx tauri dev        # opens window; Vite on 5173 proxies /api → :8765

# 3) other useful commands
npm run lint         # oxlint
npx tsc -b --noEmit  # typecheck
```

On first use open **Settings → Motor local → Baixar assets** (or it happens implicitly on first record/generate). Assets land in `~/.local/share/zorrilho/models/hushmic/`; XTTS v2 model in `~/.local/share/zorrilho/models/` + HF cache `~/.local/share/zorrilho/hf`.

Environment overrides (see `.env.example`):

```bash
ZORRILHO_DATA_DIR=$HOME/.local/share/zorrilho
PORT=8765
COQUI_TOS_AGREED=1
```

## Sidecar API

Base `http://127.0.0.1:8765`. Health is also reachable via Vite proxy as `http://localhost:5173/health`.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/health` | `{ status, db, models_dir, hushmic_assets }` |
| `POST` | `/api/assets/ensure` | Download missing HushMic assets (verified) |
| `GET` | `/api/profiles` | List voice profiles |
| `POST` | `/api/profiles` | `multipart`: `name`, `engine` (`xtts_v2`/`gpt_sovits`), `audio` (WAV/MP3), `ref_text?` |
| `DELETE` | `/api/profiles/{id}` | Remove profile + refs |
| `POST` | `/api/generate` | JSON `{ text, profile_id, language }` → `{ task_id }` |
| `WS` | `/ws/progress/{task_id}` | JSON events `{ stage, progress, generation_id? }` |
| `GET` | `/api/generations?profile_id=` | List generations |
| `GET` | `/api/generations/{id}/audio` | WAV |
| `GET` | `/api/generations/{id}/export?format=wav|mp3` | Download; `mp3` via `ffmpeg` |

DB: SQLite `~/.local/share/zorrilho/zorrilho.db`, tables `voice_profiles` / `generation_history`.

## Project layout

```
zorrilho/
├── app/                     # Tauri frontend + shell
│   ├── src/                 # React (lib/sidecar.ts, lib/store.ts, components/*)
│   ├── src-tauri/           # Rust (lib.rs, sidecar.rs, audio/mod.rs, build.rs)
│   │   └── examples/test_audio.rs
│   ├── public/ & src/assets # icons (zorrilho.svg), hero, favicon
│   ├── vite.config.ts       # dev proxy → :8765
│   └── package.json
├── sidecar/                 # Python FastAPI
│   ├── zorrilho/            # main.py, models.py, engines.py, downloader.py, __main__.py
│   ├── pyproject.toml       # uv project, requires-python 3.11
│   └── uv.lock
├── packaging/               # Arch PKGBUILD + wrapper + desktop entry
│   ├── PKGBUILD
│   ├── zorrilho-sidecar     # lazy venv bootstrap (uv → pip fallback)
│   ├── zorrilho.desktop
│   └── zorrilho.install
├── LICENSE                  # Apache-2.0
├── README.md                # this file (EN)
├── README.pt-BR.md
├── README.es.md
└── .env.example
```

## Packaging (Arch)

```bash
cd packaging
makepkg -si   # builds app (npm + cargo --frozen --release) → package
# or: makepkg --printsrcinfo > .SRCINFO  # for AUR
```

What gets installed:

- ` /usr/bin/zorrilho` — Tauri binary
- `/opt/zorrilho/sidecar/` — sidecar Python sources
- `/opt/zorrilho/bin/zorrilho-sidecar` — first-run wrapper that creates `~/.local/share/zorrilho/venv` and installs `torch+cu128`, `coqui-tts`, etc.
- `/usr/share/applications/zorrilho.desktop` + license to `/usr/share/licenses/zorrilho/`

Cached models/data are **never** packaged; they stay per-user in `~/.local/share/zorrilho/`.

AUR release flow (maintainer):

```bash
git tag v0.1.0 && git push origin v0.1.0   # upstream tag PKGBUILD expects
git clone ssh://aur@aur.archlinux.org/zorrilho.git /tmp/aur-zorrilho
cp packaging/{PKGBUILD,zorrilho.install} /tmp/aur-zorrilho/
cd /tmp/aur-zorrilho && makepkg --printsrcinfo > .SRCINFO
git add -A && git commit -m "zorrilho 0.1.0-1" && git push
```

## Security & privacy

- All inference is local; no audio or text leaves the machine except the one-time model download (Hugging Face / GitHub raw).
- No secrets are committed: `.env`, `*.pem`, `*.key`, `*.db`, `*.wav` are gitignored. Copy `.env.example` → `.env` if you need overrides.
- HushMic assets are SHA-256 pinned (`ONNX_SHA256`, `WEIGHTS_SHA256` in `sidecar/zorrilho/downloader.py`).

## Licenses

- **This project — Apache-2.0** (see `LICENSE`). `app/src-tauri/Cargo.toml`, `packaging/PKGBUILD`, `app/package.json`, `sidecar/pyproject.toml` all declare `Apache-2.0`.
- **DPDFNet** (Ceva) — Apache-2.0, denoising model.
- **hushmic-denoiser** — MIT OR Apache-2.0.
- **Coqui TTS / XTTS v2** — **CPML** (non-commercial, research-friendly). The model is **not** redistributed; it is fetched on first use. By using XTTS you agree to https://coqui.ai/cpml . `COQUI_TOS_AGREED=1` is exported by the app/sidecar to auto-accept Coqui's ToS prompt.

## Troubleshooting

- **Sidecar not reachable** (`ERR_CONNECTION_REFUSED` / `Failed to fetch`): make sure it is running — either `npx tauri dev` (auto-spawn, wait ~30 s health) or `uv run uvicorn zorrilho.main:app --port 8765` manually. In Vite dev, `/api` goes through the proxy; going direct to `:8765` without the proxy needs CORS (already enabled in `main.py`).
- **HushMic model not found**: open *Configurações/Settings* and trigger *Baixar/Download assets*, or `POST /api/assets/ensure`; check `~/.local/share/zorrilho/models/hushmic/`.
- **MP3 export fails**: install `ffmpeg`.
- **CUDA not found**: install `nvidia-utils`; CPU fallback works but generation is slow.
