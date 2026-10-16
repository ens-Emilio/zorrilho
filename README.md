# 🦨 Zorrilho

Clonagem de voz local para Linux (Arch), com denoising de microfone em tempo real.

- **TTS:** XTTS v2 (Coqui, zero-shot, GPU CUDA) — engine `gpt_sovits` reservada no registry
- **Denoising:** DPDFNet via crate `hushmic-denoiser` ( engine nativa INT8, AVX2 ) — sem daemon, in-process
- **Shell:** Tauri v2 ( Rust + React + TypeScript )
- **Sidecar:** FastAPI + SQLAlchemy, spawn automático pelo shell
- **Persistência:** SQLite em `~/.local/share/zorrilho/`

## Uso (dev)

```bash
# sidecar sobe sozinho dentro do app; para dev manual:
cd sidecar && uv sync && uv run uvicorn zorrilho.main:app --port 8765

# app:
cd app && npm i && npx tauri dev
```

No primeiro uso o app baixa automaticamente:
- XTTS v2 (~1,8 GB) → `~/.local/share/zorrilho/models/`
- Assets DPDFNet (~29 MB, SHA256 verificados) → mesmo local

Licença XTTS: **CPML (não-comercial)** — https://coqui.ai/cpml

## Pacote (Arch)

```bash
cd packaging
makepkg -si   # builda Tauri + instala /opt/zorrilho + /usr/bin/zorrilho
```

Estratégia de empacotamento: o pacote tem só **4,6 MB** ( binário Tauri + fontes do sidecar + wrapper ). O venv Python com torch CUDA (~2,5 GB) é criado **no primeiro uso** pelo wrapper `/opt/zorrilho/bin/zorrilho-sidecar`, via `uv` ( fallback `pip` ).

## Publicar no AUR

```bash
# 1. repo upstream precisa existir com a tag
git tag v0.1.0 && git push origin v0.1.0

# 2. PKGBUILD de release ( fonte = git tag )
#    já em packaging/PKGBUILD — confira url/sha256sums

# 3. AUR: clonar e subir
git clone ssh://aur@aur.archlinux.org/zorrilho.git /tmp/aur-zorrilho
cp packaging/PKGBUILD packaging/zorrilho.install /tmp/aur-zorrilho/
# gerar .SRCINFO:
cd /tmp/aur-zorrilho && makepkg --printsrcinfo > .SRCINFO
git add -A && git commit -m "zorrilho 0.1.0-1" && git push
```

Usuários instalam com `yay -S zorrilho`.

## API do sidecar

| Endpoint | Descrição |
|:--|:--|
| `GET /health` | status + prontidão de assets |
| `POST /api/assets/ensure` | baixa assets DPDFNet faltantes |
| `GET/POST/DELETE /api/profiles` | CRUD de perfis de voz ( multipart ) |
| `POST /api/generate` | gera áudio → `{task_id}` |
| `WS /ws/progress/{task_id}` | progresso em tempo real |
| `GET /api/generations` | histórico ( `?profile_id=` ) |
| `GET /api/generations/{id}/audio` | WAV da geração |
| `GET /api/generations/{id}/export?format=wav\|mp3` | download ( mp3 via ffmpeg ) |
