# 🦨 Zorrilho

> Clonación de voz local y 100% offline para Linux (Arch) — XTTS v2 + reducción de ruido de micrófono en tiempo real (DPDFNet).

**Idiomas:** [English](README.md) · [Português (BR)](README.pt-BR.md) · [Español](README.es.md)

Zorrilho es una app de escritorio para clonar tu propia voz a partir de una muestra corta (~6 s) y generar habla desde cualquier guion — todo en el dispositivo. Sin nube, sin cuenta, sin audio que sale de la máquina. Combina [Coqui XTTS v2](https://coqui.ai) (TTS zero-shot) con [HushMic](https://github.com/Fovty/hushmic) / [DPDFNet](https://github.com/ceva-ip/DPDFNet) para supresión de ruido en tiempo real durante la captura.

---

## Funcionalidades

- **Clonación zero-shot** — una muestra de 6 s+ en cualquier idioma que XTTS v2 soporte (`es`, `pt`, `en`, …).
- **Reducción de ruido in-process** — motor `native` de DPDFNet (INT8, AVX2) vía `hushmic-denoiser`; sin daemon de PipeWire.
- **Estudio en 4 pestañas** — *Clonar* (grabar / subir referencia → crear perfil), *Estudio* (guion → generar), *Proyectos* (historial + reproductor + exportar WAV/MP3), *Configuración* (estado, descargar assets).
- **Progreso en tiempo real** — `POST /api/generate` devuelve `task_id`; `WS /ws/progress/{task_id}` emite etapas.
- **Datos autocontenidos** — todo en `~/.local/share/zorrilho/` (SQLite, refs, generaciones, modelos).
- **Modelos lazy** — XTTS v2 (~1,8 GB) y assets de HushMic (~29 MB) se descargan en el primer uso, verificados con SHA-256.
- **Empaquetado Arch nativo** — `makepkg -si` → `/usr/bin/zorrilho` + `/opt/zorrilho` + entrada de escritorio; el venv de Python se crea en el primer uso (sin blob CUDA de 2,5 GB dentro del paquete).

## Arquitectura

```
┌─────────────────────────────────────────────┐
│  Shell Tauri v2 (Rust)  — app/src-tauri/    │
│  React + TypeScript + Tailwind v4 — app/    │
│  audio::record_start/stop (cpal + hound)    │
│  hushmic-denoiser StreamDenoiser (native)   │
│  spawn del sidecar + polling /health + stop │
└──────────────────┬──────────────────────────┘
                   │ HTTP + WebSocket (127.0.0.1:8765)
                   ▼
┌─────────────────────────────────────────────┐
│  Sidecar FastAPI — sidecar/zorrilho/        │
│  /health, /api/profiles, /api/generate,     │
│  /ws/progress/{id}, /api/generations,       │
│  /api/assets/ensure                         │
│  SQLAlchemy + SQLite  ·  registry de engines│
│    xtts_v2 (Coqui)  ·  gpt_sovits (stub)    │
└─────────────────────────────────────────────┘
```

Proxy de dev: `app/vite.config.ts` redirige `/api`, `/health` y `/ws` → `localhost:8765` para que `vite dev` evite CORS. En producción (Tauri) la app apunta directo a `http://localhost:8765`; el WS deriva de la misma base.

## Stack

| Capa | Tecnología |
|---|---|
| Shell de escritorio | Tauri v2 (Rust), `tauri-plugin-log` |
| UI | React 19 + TypeScript 6 + Vite 8 + Tailwind CSS v4, Zustand, Headless UI, Heroicons |
| Captura de audio | `cpal` + `hound` + `hushmic-denoiser` (git, feature `native`) |
| Sidecar | FastAPI + Uvicorn + SQLAlchemy + Alembic + `python-multipart` + `soundfile` + `websockets` |
| TTS | `coqui-tts==0.25.3` · XTTS v2 `tts_models/multilingual/multi-dataset/xtts_v2`; `gpt_sovits` reservado |
| Assets de denoising | `dpdfnet==0.5.1` (ONNX) + `.weights.f32` de DPDFNet Ceva (commit fijado, SHA-256) |
| Empaquetado | `packaging/PKGBUILD` + wrapper `zorrilho-sidecar` (venv lazy `uv`/`pip`) + `zorrilho.desktop` |

## Requisitos

- Arch Linux (o derivado), `webkit2gtk-4.1`, `gtk3`, `ffmpeg` (para exportar MP3).
- Para TTS: GPU NVIDIA + `nvidia-utils` recomendado; CPU funciona pero es más lento. CUDA vía `pip` `torch==2.5.0+cu128`.
- Build: `rust` ≥1.90, `nodejs` ≥20 + `npm`, `git`; para sidecar en dev: `uv` (o `python 3.11` + `pip`).

## Inicio rápido (dev)

```bash
# 1) sidecar solo (opcional — Tauri lo levanta automáticamente)
cd sidecar
uv sync
uv run uvicorn zorrilho.main:app --port 8765 --host 127.0.0.1

# 2) app de escritorio (Vite + Tauri dev)
cd app
npm ci
npm run build        # comprobación
npx tauri dev        # abre ventana; Vite en 5173 hace proxy /api → :8765

# 3) otros comandos útiles
npm run lint         # oxlint
npx tsc -b --noEmit  # chequeo de tipos
```

En el primer uso abre **Configuración → Motor local → Descargar assets** (o sucede implícito al grabar/generar). Los assets quedan en `~/.local/share/zorrilho/models/hushmic/`; el modelo XTTS v2 en `~/.local/share/zorrilho/models/` + caché HF `~/.local/share/zorrilho/hf`.

Overrides por entorno (ver `.env.example`):

```bash
ZORRILHO_DATA_DIR=$HOME/.local/share/zorrilho
PORT=8765
COQUI_TOS_AGREED=1
```

## API del sidecar

Base `http://127.0.0.1:8765`. Health también vía proxy de Vite: `http://localhost:5173/health`.

| Método | Ruta | Notas |
|---|---|---|
| `GET` | `/health` | `{ status, db, models_dir, hushmic_assets }` |
| `POST` | `/api/assets/ensure` | Descarga assets faltantes de HushMic (verificado) |
| `GET` | `/api/profiles` | Lista perfiles de voz |
| `POST` | `/api/profiles` | `multipart`: `name`, `engine` (`xtts_v2`/`gpt_sovits`), `audio` (WAV/MP3), `ref_text?` |
| `DELETE` | `/api/profiles/{id}` | Elimina perfil + refs |
| `POST` | `/api/generate` | JSON `{ text, profile_id, language }` → `{ task_id }` |
| `WS` | `/ws/progress/{task_id}` | Eventos JSON `{ stage, progress, generation_id? }` |
| `GET` | `/api/generations?profile_id=` | Lista generaciones |
| `GET` | `/api/generations/{id}/audio` | WAV |
| `GET` | `/api/generations/{id}/export?format=wav|mp3` | Descarga; `mp3` vía `ffmpeg` |

BD: SQLite `~/.local/share/zorrilho/zorrilho.db`, tablas `voice_profiles` / `generation_history`.

## Estructura del proyecto

```
zorrilho/
├── app/                     # frontend + shell Tauri
│   ├── src/                 # React (lib/sidecar.ts, lib/store.ts, components/*)
│   ├── src-tauri/           # Rust (lib.rs, sidecar.rs, audio/mod.rs, build.rs)
│   │   └── examples/test_audio.rs
│   ├── public/ & src/assets # iconos (zorrilho.svg), hero, favicon
│   ├── vite.config.ts       # proxy dev → :8765
│   └── package.json
├── sidecar/                 # FastAPI Python
│   ├── zorrilho/            # main.py, models.py, engines.py, downloader.py, __main__.py
│   ├── pyproject.toml       # proyecto uv, requires-python 3.11
│   └── uv.lock
├── packaging/               # PKGBUILD Arch + wrapper + desktop entry
│   ├── PKGBUILD
│   ├── zorrilho-sidecar     # bootstrap del venv lazy (uv → pip fallback)
│   ├── zorrilho.desktop
│   └── zorrilho.install
├── LICENSE                  # Apache-2.0
├── README.md                # EN
├── README.pt-BR.md
├── README.es.md             # este archivo
└── .env.example
```

## Empaquetado (Arch)

```bash
cd packaging
makepkg -si   # compila la app (npm + cargo --frozen --release) → paquete
# o: makepkg --printsrcinfo > .SRCINFO  # para AUR
```

Qué se instala:

- `/usr/bin/zorrilho` — binario Tauri
- `/opt/zorrilho/sidecar/` — fuentes Python del sidecar
- `/opt/zorrilho/bin/zorrilho-sidecar` — wrapper que en el primer uso crea `~/.local/share/zorrilho/venv` e instala `torch+cu128`, `coqui-tts` etc.
- `/usr/share/applications/zorrilho.desktop` + licencia en `/usr/share/licenses/zorrilho/`

Los modelos/datos en caché **nunca** van en el paquete; quedan por usuario en `~/.local/share/zorrilho/`.

Flujo de release en AUR (maintainer):

```bash
git tag v0.1.0 && git push origin v0.1.0   # tag que PKGBUILD espera
git clone ssh://aur@aur.archlinux.org/zorrilho.git /tmp/aur-zorrilho
cp packaging/{PKGBUILD,zorrilho.install} /tmp/aur-zorrilho/
cd /tmp/aur-zorrilho && makepkg --printsrcinfo > .SRCINFO
git add -A && git commit -m "zorrilho 0.1.0-1" && git push
```

## Seguridad y privacidad

- Toda la inferencia es local; ningún audio o texto sale de la máquina salvo la descarga única de modelos (Hugging Face / GitHub raw).
- No se commitean secretos: `.env`, `*.pem`, `*.key`, `*.db`, `*.wav` están en `.gitignore`. Copia `.env.example` → `.env` si necesitas overrides.
- Los assets de HushMic están fijados por SHA-256 (`ONNX_SHA256`, `WEIGHTS_SHA256` en `sidecar/zorrilho/downloader.py`).

## Licencias

- **Este proyecto — Apache-2.0** (ver `LICENSE`). `app/src-tauri/Cargo.toml`, `packaging/PKGBUILD`, `app/package.json` y `sidecar/pyproject.toml` declaran `Apache-2.0`.
- **DPDFNet** (Ceva) — Apache-2.0, modelo de denoising.
- **hushmic-denoiser** — MIT OR Apache-2.0.
- **Coqui TTS / XTTS v2** — **CPML** (no comercial, académica). El modelo **no** se redistribuye; se descarga en el primer uso. Al usar XTTS aceptas https://coqui.ai/cpml . `COQUI_TOS_AGREED=1` lo exporta la app/sidecar para auto-aceptar el ToS de Coqui.

## Solución de problemas

- **Sidecar no accesible** (`ERR_CONNECTION_REFUSED` / `Failed to fetch`): verifica que esté corriendo — `npx tauri dev` (auto-spawn, ~30 s health) o `uv run uvicorn zorrilho.main:app --port 8765` manual. En `vite dev`, `/api` va por el proxy; ir directo a `:8765` sin proxy necesita CORS (ya habilitado en `main.py`).
- **Modelo HushMic no encontrado**: abre *Configuración* y pulsa *Descargar assets*, o `POST /api/assets/ensure`; revisa `~/.local/share/zorrilho/models/hushmic/`.
- **Exportar MP3 falla**: instala `ffmpeg`.
- **CUDA no encontrado**: instala `nvidia-utils`; el fallback en CPU funciona pero la generación es lenta.
