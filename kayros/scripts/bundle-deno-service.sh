#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

mkdir -p "$PROJECT_DIR/dist"

./node_modules/.bin/esbuild \
  "$PROJECT_DIR/src-deno/service.ts" \
  --bundle \
  --format=esm \
  --platform=neutral \
  --main-fields=main,module \
  --target=es2022 \
  --sourcemap \
  --outfile="$PROJECT_DIR/dist/service.js"
