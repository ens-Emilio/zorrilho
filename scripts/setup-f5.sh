#!/usr/bin/env bash
# Cria o venv F5-TTS dedicado (numpy>=2, necessário pois coqui-tts pina numpy<2
# e não podem coexistir no mesmo env). O Zorrilho despacha F5 por subprocess.
#
# Uso: ./scripts/setup-f5.sh   (cria sidecar/.venv-f5 + instala f5-tts)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SIDECAR="$ROOT/sidecar"
VENV="$SIDECAR/.venv-f5"

command -v uv >/dev/null 2>&1 || { echo "uv ausente"; exit 1; }

if [ ! -d "$VENV" ]; then
  echo "==> criando venv F5 em $VENV"
  uv venv --python 3.11 "$VENV"
fi

echo "==> instalando f5-tts (numpy>=2, torch cpu/cuda) em $VENV"
uv pip install --python "$VENV/bin/python" \
  "numpy>=2.0" "f5-tts>=1.0" 2>&1 | tail -8

echo "==> verificando import"
uv run --python "$VENV/bin/python" python -c "import f5_tts; print('f5_tts ok')" 2>&1 | tail -5

echo "==> F5 pronto. Primeira síntese baixa o modelo (~1.3GB)."
