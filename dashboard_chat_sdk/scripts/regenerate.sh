#!/usr/bin/env bash
# Regenerate dashboard_chat_sdk from the live FastAPI OpenAPI schema.
#
# Run from any directory; uses the SDK package root as anchor.
set -euo pipefail

SDK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$SDK_ROOT/.." && pwd)"
OPENAPI_JSON="$SDK_ROOT/openapi.json"
GENERATED_DIR="$SDK_ROOT/src/dashboard_chat_sdk/_generated"

echo "==> Dumping FastAPI OpenAPI schema → $OPENAPI_JSON"
(cd "$REPO_ROOT/backend" && uv run python scripts/export_openapi.py "$OPENAPI_JSON")

echo "==> Regenerating client into $GENERATED_DIR"
rm -rf "$GENERATED_DIR"
mkdir -p "$(dirname "$GENERATED_DIR")"

# openapi-python-client emits to a configurable package; we point it at our
# _generated subpackage so the SDK keeps an opaque public surface.
uvx --from openapi-python-client@0.28.3 openapi-python-client generate \
    --path "$OPENAPI_JSON" \
    --output-path "$GENERATED_DIR" \
    --overwrite \
    --meta none \
    --config "$SDK_ROOT/scripts/codegen-config.yaml"

echo "==> Done. Inspect with: git status -- $GENERATED_DIR"
