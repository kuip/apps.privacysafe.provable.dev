#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STARTUP_DIR="/Users/user/dev/projects/w3n/startup.app.privacysafe.io"
PLATFORM_MAC_DIR="/Users/user/dev/projects/w3n/privacysafe-platform-electron/mac"
TEST_STAND_FILE="$ROOT_DIR/test-stand.dev.example.json"
DATA_DIR="/tmp/privacysafe-provable-dev"

declare -a PIDS=()

log() {
  printf '[dev] %s\n' "$*"
}

ensure_dir() {
  mkdir -p "$1"
}

ensure_deps() {
  local name="$1"
  local dir="$2"
  local install_cmd="$3"
  local sentinel="${4:-$dir/node_modules}"

  if [[ -e "$sentinel" ]]; then
    log "$name dependencies already present"
    return
  fi

  log "Installing $name dependencies"
  (
    cd "$dir"
    eval "$install_cmd"
  )
}

start_proc() {
  local name="$1"
  local dir="$2"
  shift 2

  log "Starting $name"
  (
    cd "$dir"
    "$@" \
      > >(while IFS= read -r line; do printf '[%s] %s\n' "$name" "$line"; done) \
      2> >(while IFS= read -r line; do printf '[%s] %s\n' "$name" "$line" >&2; done)
  ) &

  PIDS+=("$!")
}

cleanup() {
  local exit_code="${1:-0}"

  for pid in "${PIDS[@]:-}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done

  wait || true
  exit "$exit_code"
}

trap 'cleanup 130' INT TERM

ensure_dir "$STARTUP_DIR/app"
ensure_dir "$ROOT_DIR/kayros/app"

ensure_deps "startup.app.privacysafe.io" "$STARTUP_DIR" "pnpm install" "$STARTUP_DIR/node_modules/.bin/vite"
ensure_deps "nomen.app.provable.dev" "$ROOT_DIR/nomen" "npm ci" "$ROOT_DIR/nomen/node_modules/.bin/vite"
ensure_deps "kayros.app.provable.dev" "$ROOT_DIR/kayros" "npm ci" "$ROOT_DIR/kayros/node_modules/.bin/vite"
ensure_deps "privacysafe-platform-electron/mac" "$PLATFORM_MAC_DIR" "npm ci" "$PLATFORM_MAC_DIR/node_modules/.bin/pbjs"

log "Compiling PrivacySafe platform"
(
  cd "$PLATFORM_MAC_DIR"
  npm run compile platform
)

start_proc "startup" "$STARTUP_DIR" pnpm dev --host 127.0.0.1
start_proc "nomen" "$ROOT_DIR/nomen" npm run dev -- --host 127.0.0.1 --port 5174
start_proc "kayros" "$ROOT_DIR/kayros" npm run dev -- --host 127.0.0.1 --port 5175
start_proc "platform" "$PLATFORM_MAC_DIR" npm run start-app -- --data-dir="$DATA_DIR" --test-stand="$TEST_STAND_FILE"

log "Dev stack started"
log "nomen.app.provable.dev -> http://127.0.0.1:5174"
log "kayros.app.provable.dev -> http://127.0.0.1:5175"
log "startup.app.privacysafe.io -> http://127.0.0.1:3030"
log "Press Ctrl+C to stop everything"

while true; do
  for pid in "${PIDS[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      wait "$pid" || exit_code=$?
      exit_code="${exit_code:-1}"
      log "A child process exited with code $exit_code; shutting down the dev stack"
      cleanup "$exit_code"
    fi
  done
  sleep 1
done
