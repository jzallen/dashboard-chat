#!/usr/bin/env bash
set -euo pipefail

# Called by Bazel to run Vite build
# Output directory is passed as first argument
OUT_DIR="$1"

cd reverse-proxy
NODE_ENV=production npx vite build --outDir "../${OUT_DIR}" --emptyOutDir
