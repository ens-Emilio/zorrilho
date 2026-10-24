#!/usr/bin/env bash
# Instala o GPT-SoVITS (repo clone) + modelos pré-treinados v2 + venv dedicado.
# GPT-SoVITS NÃO é pacote pip: repo RVC-Boss/GPT-SoVITS (MIT) + weights + env próprio.
#
# Uso: ./scripts/setup-gpt-sovits.sh [DIR]
#   DIR default: ~/.local/share/zorrilho/gpt_sovits (onde main.py procura)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="${ZORRILHO_DATA_DIR:-$HOME/.local/share/zorrilho}"
DEST="${1:-$DATA_DIR/gpt_sovits}"
HF="https://huggingface.co/lj1995/GPT-SoVITS/resolve/main"
command -v uv >/dev/null 2>&1 || { echo "uv ausente"; exit 1; }

if [ ! -d "$DEST/GPT_SoVITS" ]; then
  echo "==> clonando RVC-Boss/GPT-SoVITS → $DEST"
  mkdir -p "$(dirname "$DEST")"
  git clone --depth 1 https://github.com/RVC-Boss/GPT-SoVITS.git "$DEST"
fi

VENV="$DEST/.venv"
if [ ! -x "$VENV/bin/python" ]; then
  echo "==> criando venv dedicado GPT-SoVITS"
  uv venv --python 3.11 "$VENV"
  echo "==> instalando requirements (torch>=2.6 + deps)"
  uv pip install --python "$VENV/bin/python" "torch>=2.6" "torchaudio>=2.6" 2>&1 | tail -3
  (cd "$DEST" && uv pip install --python "$VENV/bin/python" -r requirements.txt 2>&1 | tail -5)
  # deps descobertas na verificação de inferência/treino
  uv pip install --python "$VENV/bin/python" torchcodec resampy faster-whisper 2>&1 | tail -3
fi

PRET="$DEST/GPT_SoVITS/pretrained_models"
mkdir -p "$PRET/gsv-v2final-pretrained"
fetch() { if [ ! -f "$2" ]; then echo "==> $(basename "$2")"; curl -L --fail --progress-bar "$1" -o "$2"; fi; }
fetch "$HF/gsv-v2final-pretrained/s2G2333k.pth" "$PRET/gsv-v2final-pretrained/s2G2333k.pth"
fetch "$HF/gsv-v2final-pretrained/s2D2333k.pth" "$PRET/gsv-v2final-pretrained/s2D2333k.pth"
fetch "$HF/gsv-v2final-pretrained/s1bert25hz-5kh-longer-epoch%3D12-step%3D369668.ckpt" \
      "$PRET/gsv-v2final-pretrained/s1bert25hz-5kh-longer-epoch=12-step=369668.ckpt"

echo "==> baixando chinese-hubert-base + chinese-roberta"
"$VENV/bin/python" - <<'PY' || true
from huggingface_hub import snapshot_download
import pathlib
pret = pathlib.Path("GPT_SoVITS/pretrained_models")
for repo, sub in [("TencentGameMate/chinese-hubert-base", "chinese-hubert-base"),
                  ("hfl/chinese-roberta-wwm-ext-large", "chinese-roberta-wwm-ext-large")]:
    snapshot_download(repo_id=repo, local_dir=str(pret / sub))
    print("ok", sub)
PY

echo "==> GPT-SoVITS pronto em $DEST (venv: $VENV)"
echo "    modelos: $(find "$PRET" -type f | wc -l) arquivos"