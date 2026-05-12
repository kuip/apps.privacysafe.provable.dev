#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

mkdir -p "$PROJECT_DIR/dist"

deno bundle \
  --platform deno \
  --no-check \
  "$PROJECT_DIR/src-deno/service.ts" \
  --output "$PROJECT_DIR/dist/service.js"
