#!/usr/bin/env bash
set -euo pipefail

# Bazel executes tests from a runfiles directory containing symlinks back to
# the workspace. BASH_SOURCE[0] gives the path of this script within that
# runfiles tree; readlink -f resolves it to the real workspace path so that
# uv finds the pre-synced .venv and ruff's default excludes apply correctly.
THIS_FILE="$(readlink -f "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(cd "$(dirname "${THIS_FILE}")" && pwd)"
cd "${SCRIPT_DIR}"

uv run ruff check .
uv run ruff format --check .
