# 🦨 Zorrilho

> Clonagem de voz local, 100% offline, para Linux (Arch) — XTTS v2 + denoising de microfone em tempo real (DPDFNet).

**Idiomas:** [English](README.md) · [Português (BR)](README.pt-BR.md) · [Español](README.es.md)

Zorrilho é um app desktop para clonar sua própria voz a partir de uma amostra curta (~6 s) e gerar fala a partir de qualquer roteiro — tudo no dispositivo. Sem nuvem, sem conta, sem áudio saindo da máquina. Combina [Coqui XTTS v2](https://coqui.ai) (TTS zero-shot) com [HushMic](https://github.com/Fovty/hushmic) / [DPDFNet](https://github.com/ceva-ip/DPDFNet) para supressão de ruído em tempo real na captura.

---

## Funcionalidades

- **Clone zero-shot** — uma amostra de 6 s+ em qualquer idioma que o XTTS v2 suporta (`pt`, `en`, `es`, …).
- **Denoising in-process** — engine `native` do DPDFNet (INT8, AVX2) via `hushmic-denoiser`; sem daemon PipeWire.
- **Estúdio em 4 abas** — *Clonar* (gravar / enviar referência → criar perfil), *Estúdio* (roteiro → gerar), *Projetos* (histórico + player + export WAV/MP3), *Configurações* (saúde, baixar assets).
- **Progresso em tempo real** — `POST /api/generate` devolve `task_id`; `WS /ws/progress/{task_id}` transmite etapas.
- **Dados autocontidos** — tudo em `~/.local/share/zorrilho/` (SQLite, refs, gerações, modelos).
- **Modelos lazy** — XTTS v2 (~1,8 GB) e assets HushMic (~29 MB) baixam no primeiro uso, com SHA-256 verificado.
- **Empacotamento nativo Arch** — `makepkg -si` → `/usr/bin/zorrilho` + `/opt/zorrilho` + entrada no menu; o venv Python é criado no primeiro uso (sem 2,5 GB de CUDA dentro do pacote).

## Arquitetura

```
┌─────────────────────────────────────────────┐
│  Shell Tauri v2 (Rust)  — app/src-tauri/    │
│  React + TypeScript + Tailwind v4 — app/    │
│  audio::record_start/stop (cpal + hound)    │
│  hushmic-denoiser StreamDenoiser (native)   │
│  spawn do sidecar + polling /health + stop  │
└──────────────────┬──────────────────────────┘
                   │ HTTP + WebSocket (127.0.0.1:8765)
                   ▼
┌─────────────────────────────────────────────┐
│  Sidecar FastAPI — sidecar/zorrilho/        │
│  /health, /api/profiles, /api/generate,     │
│  /ws/progress/{id}, /api/generations,       │
│  /api/assets/ensure                         │
│  SQLAlchemy + SQLite  ·  engine registry     │
│    xtts_v2 (Coqui)  ·  gpt_sovits (stub)    │
└─────────────────────────────────────────────┘
```

Proxy de dev: `app/vite.config.ts` redireciona `/api`, `/health` e `/ws` → `localhost:8765` para que o `vite dev` não caia em CORS. Em produção (Tauri), o app acerta `http://localhost:8765` direto; o WS deriva da mesma base.

## Stack

| Camada | Tecnologia |
|---|---|
| Shell desktop | Tauri v2 (Rust), `tauri-plugin-log` |
| UI | React 19 + TypeScript 6 + Vite 8 + Tailwind CSS v4, Zustand, Headless UI, Heroicons |
| Captura de áudio | `cpal` + `hound` + `hushmic-denoiser` (git, feature `native`) |
| Sidecar | FastAPI + Uvicorn + SQLAlchemy + Alembic + `python-multipart` + `soundfile` + `websockets` |
| TTS | `coqui-tts==0.25.3` · XTTS v2 `tts_models/multilingual/multi-dataset/xtts_v2`; `gpt_sovits` reservado |
| Assets de denoising | `dpdfnet==0.5.1` (ONNX) + `.weights.f32` do DPDFNet Ceva (commit pinado, SHA-256) |
| Empacotamento | `packaging/PKGBUILD` + wrapper `zorrilho-sidecar` (venv lazy `uv`/`pip`) + `zorrilho.desktop` |

## Requisitos

- Arch Linux (ou derivado), `webkit2gtk-4.1`, `gtk3`, `ffmpeg` (para export MP3).
- Para TTS: GPU NVIDIA + `nvidia-utils` recomendado; CPU funciona, mas é mais lento. CUDA via `pip` `torch==2.5.0+cu128`.
- Build: `rust` ≥1.90, `nodejs` ≥20 + `npm`, `git`; para o sidecar em dev: `uv` (ou `python 3.11` + `pip`).

## Início rápido (dev)

```bash
# 1) sidecar sozinho (opcional — o Tauri já sobe sozinho)
cd sidecar
uv sync
uv run uvicorn zorrilho.main:app --port 8765 --host 127.0.0.1

# 2) app desktop (Vite + Tauri dev)
cd app
npm ci
npm run build        # sanity check
npx tauri dev        # abre a janela; Vite em 5173 faz proxy /api → :8765

# 3) comandos úteis
npm run lint         # oxlint
npx tsc -b --noEmit  # checagem de tipos
```

No primeiro uso, abra **Configurações → Motor local → Baixar assets** (ou acontece implícito no primeiro gravar/gerar). Os assets ficam em `~/.local/share/zorrilho/models/hushmic/`; o modelo XTTS v2 em `~/.local/share/zorrilho/models/` + cache HF `~/.local/share/zorrilho/hf`.

Overrides por ambiente (veja `.env.example`):

```bash
ZORRILHO_DATA_DIR=$HOME/.local/share/zorrilho
PORT=8765
COQUI_TOS_AGREED=1
```

## API do sidecar

Base `http://127.0.0.1:8765`. Health também via proxy do Vite: `http://localhost:5173/health`.

| Método | Rota | Notas |
|---|---|---|
| `GET` | `/health` | `{ status, db, models_dir, hushmic_assets }` |
| `POST` | `/api/assets/ensure` | Baixa assets HushMic faltantes (verificado) |
| `GET` | `/api/profiles` | Lista perfis de voz |
| `POST` | `/api/profiles` | `multipart`: `name`, `engine` (`xtts_v2`/`gpt_sovits`), `audio` (WAV/MP3), `ref_text?` |
| `DELETE` | `/api/profiles/{id}` | Remove perfil + refs |
| `POST` | `/api/generate` | JSON `{ text, profile_id, language }` → `{ task_id }` |
| `WS` | `/ws/progress/{task_id}` | Eventos JSON `{ stage, progress, generation_id? }` |
| `GET` | `/api/generations?profile_id=` | Lista gerações |
| `GET` | `/api/generations/{id}/audio` | WAV |
| `GET` | `/api/generations/{id}/export?format=wav|mp3` | Download; `mp3` via `ffmpeg` |

Banco: SQLite `~/.local/share/zorrilho/zorrilho.db`, tabelas `voice_profiles` / `generation_history`.

## Layout do projeto

```
zorrilho/
├── app/                     # frontend + shell Tauri
│   ├── src/                 # React (lib/sidecar.ts, lib/store.ts, components/*)
│   ├── src-tauri/           # Rust (lib.rs, sidecar.rs, audio/mod.rs, build.rs)
│   │   └── examples/test_audio.rs
│   ├── public/ & src/assets # ícones (zorrilho.svg), hero, favicon
│   ├── vite.config.ts       # proxy dev → :8765
│   └── package.json
├── sidecar/                 # FastAPI Python
│   ├── zorrilho/            # main.py, models.py, engines.py, downloader.py, __main__.py
│   ├── pyproject.toml       # projeto uv, requires-python 3.11
│   └── uv.lock
├── packaging/               # PKGBUILD Arch + wrapper + desktop entry
│   ├── PKGBUILD
│   ├── zorrilho-sidecar     # bootstrap do venv lazy (uv → pip fallback)
│   ├── zorrilho.desktop
│   └── zorrilho.install
├── LICENSE                  # Apache-2.0
├── README.md                # EN
├── README.pt-BR.md          # este arquivo
├── README.es.md
└── .env.example
```

## Empacotamento (Arch)

```bash
cd packaging
makepkg -si   # builda o app (npm + cargo --frozen --release) → pacote
# ou: makepkg --printsrcinfo > .SRCINFO  # para AUR
```

O que é instalado:

- `/usr/bin/zorrilho` — binário Tauri
- `/opt/zorrilho/sidecar/` — fontes Python do sidecar
- `/opt/zorrilho/bin/zorrilho-sidecar` — wrapper que no primeiro uso cria `~/.local/share/zorrilho/venv` e instala `torch+cu128`, `coqui-tts` etc.
- `/usr/share/applications/zorrilho.desktop` + licença em `/usr/share/licenses/zorrilho/`

Modelos/dados em cache **nunca** vão no pacote; ficam por usuário em `~/.local/share/zorrilho/`.

Fluxo de release no AUR (maintainer):

```bash
git tag v0.1.0 && git push origin v0.1.0   # tag que o PKGBUILD espera
git clone ssh://aur@aur.archlinux.org/zorrilho.git /tmp/aur-zorrilho
cp packaging/{PKGBUILD,zorrilho.install} /tmp/aur-zorrilho/
cd /tmp/aur-zorrilho && makepkg --printsrcinfo > .SRCINFO
git add -A && git commit -m "zorrilho 0.1.0-1" && git push
```

## Segurança e privacidade

- Toda inferência é local; nada de áudio ou texto sai da máquina exceto o download único de modelos (Hugging Face / GitHub raw).
- Nenhum segredo é commitado: `.env`, `*.pem`, `*.key`, `*.db`, `*.wav` estão no `.gitignore`. Copie `.env.example` → `.env` se precisar de overrides.
- Assets do HushMic são pinados por SHA-256 (`ONNX_SHA256`, `WEIGHTS_SHA256` em `sidecar/zorrilho/downloader.py`).

## Licenças

- **Este projeto — Apache-2.0** (veja `LICENSE`). `app/src-tauri/Cargo.toml`, `packaging/PKGBUILD`, `app/package.json` e `sidecar/pyproject.toml` declaram `Apache-2.0`.
- **DPDFNet** (Ceva) — Apache-2.0, modelo de denoising.
- **hushmic-denoiser** — MIT OR Apache-2.0.
- **Coqui TTS / XTTS v2** — **CPML** (não-comercial, acadêmica). O modelo **não** é redistribuído; é buscado no primeiro uso. Ao usar o XTTS você concorda com https://coqui.ai/cpml . `COQUI_TOS_AGREED=1` é exportado pelo app/sidecar para aceitar o ToS da Coqui automaticamente.

## Solução de problemas

- **Sidecar não alcançável** (`ERR_CONNECTION_REFUSED` / `Failed to fetch`): confirme que está rodando — `npx tauri dev` (sobe auto, ~30 s de health) ou `uv run uvicorn zorrilho.main:app --port 8765` manual. No `vite dev`, o `/api` passa pelo proxy; acessar `:8765` direto sem proxy exige CORS (já habilitado em `main.py`).
- **Modelo HushMic não encontrado**: abra *Configurações* e use *Baixar assets*, ou `POST /api/assets/ensure`; confira `~/.local/share/zorrilho/models/hushmic/`.
- **Export MP3 falha**: instale `ffmpeg`.
- **CUDA não encontrado**: instale `nvidia-utils`; o fallback em CPU funciona, só que a geração fica lenta.
