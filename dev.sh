#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
SIDECAR="$ROOT/sidecar"
APP="$ROOT/app"
MODE="${1:-tauri}" # default: abre janela desktop + sidecar; use --vite só navegador

if ! command -v uv >/dev/null 2>&1; then
  echo "uv não encontrado. Instale: curl -LsSf https://astral.sh/uv/install.sh | sh"
  exit 1
fi
echo "==> sync sidecar (python 3.11) — primeira vez ~2GB, depois instantâneo"
uv python install 3.11 2>&1 | tail -2
uv sync --python 3.11 --project "$SIDECAR" 2>&1 | tail -5

fuser -k 5178/tcp 2>/dev/null || true
fuser -k 8765/tcp 2>/dev/null || true

# sobe sidecar — logs filtrados (health polling não polui terminal)
echo "==> sidecar :8765 (log filtrado, sem flood de /health)"
# --log-level warning esconde GET /health flood; [zorrilho] generate/finetune error usa print() e sempre aparece
(cd "$SIDECAR" && uv run --python 3.11 uvicorn zorrilho.main:app --host 127.0.0.1 --port 8765 --log-level warning) &
SIDECAR_PID=$!
trap 'kill $SIDECAR_PID 2>/dev/null || true; pkill -f "uvicorn zorrilho" 2>/dev/null || true; fuser -k 5178/tcp 2>/dev/null || true' EXIT INT TERM

echo -n "    aguardando /health"
for i in $(seq 1 60); do
  if curl -sf http://127.0.0.1:8765/health >/dev/null 2>&1; then echo " ok ✓"; break; fi
  echo -n "."
  sleep 1
  if [ "$i" = 60 ]; then echo " falhou"; curl -v http://127.0.0.1:8765/health 2>&1 | head -20; kill $SIDECAR_PID 2>/dev/null || true; exit 1; fi
done
curl -sf http://127.0.0.1:8765/health 2>&1 | head -c 200; echo ""

if [ "$MODE" = "--vite" ] || [ "$MODE" = "vite" ]; then
  echo "==> vite http://localhost:5178 (só navegador)"
  cd "$APP"
  [ -d node_modules ] || npm ci
  npm run dev
else
  echo "==> tauri dev — abrindo janela desktop (vite + janela em paralelo)"
  cd "$APP"
  [ -d node_modules ] || npm ci
  fuser -k 5178/tcp 2>/dev/null || true
  npm run dev &
  VITE_PID=$!
  echo "==> vite http://localhost:5178 (paralelo, aguardando ready)"
  echo -n "    aguardando vite"
  for j in $(seq 1 45); do
    if curl -sf http://localhost:5178/ >/dev/null 2>&1; then echo " ok ✓"; break; fi
    echo -n "."
    sleep 1
    if [ "$j" = 45 ]; then echo " falhou"; kill $VITE_PID 2>/dev/null || true; exit 1; fi
  done
  trap 'kill $SIDECAR_PID 2>/dev/null || true; kill $VITE_PID 2>/dev/null || true; pkill -f "uvicorn zorrilho" 2>/dev/null || true; fuser -k 5178/tcp 2>/dev/null || true' EXIT INT TERM
  npx tauri dev
fi
