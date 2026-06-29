#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_API_PORT=""
ENV_VITE_PORT=""

if [[ -f ".env" ]]; then
  ENV_API_PORT="$(sed -n 's/^[[:space:]]*API_PORT[[:space:]]*=[[:space:]]*//p' .env | tail -n 1 | sed 's/^["'\'']//; s/["'\'']$//')"
  ENV_VITE_PORT="$(sed -n 's/^[[:space:]]*VITE_PORT[[:space:]]*=[[:space:]]*//p' .env | tail -n 1 | sed 's/^["'\'']//; s/["'\'']$//')"
fi

API_PORT="${API_PORT:-${ENV_API_PORT:-8787}}"
VITE_PORT="${VITE_PORT:-${ENV_VITE_PORT:-5173}}"

stop_port() {
  local port="$1"
  local label="$2"
  local pids

  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -z "$pids" ]]; then
    echo "$label port $port: not running"
    return
  fi

  echo "$label port $port: stopping $pids"
  kill $pids 2>/dev/null || true
  sleep 1

  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    echo "$label port $port: force stopping $pids"
    kill -9 $pids 2>/dev/null || true
  fi
}

stop_port "$VITE_PORT" "frontend"
stop_port "$API_PORT" "backend"

echo "starting frontend and backend..."
echo "frontend: http://127.0.0.1:$VITE_PORT/"
echo "backend:  http://127.0.0.1:$API_PORT/"

npm run dev
