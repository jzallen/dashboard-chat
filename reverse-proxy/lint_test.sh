#!/usr/bin/env bash
set -euo pipefail

# Bazel executes tests from a runfiles directory containing symlinks back to
# the workspace. BASH_SOURCE[0] gives the path of this script within that
# runfiles tree; readlink -f resolves it to the real workspace path so that
# tool resolution (eslint config, node_modules) works correctly.
THIS_FILE="$(readlink -f "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(cd "$(dirname "${THIS_FILE}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

exec npx eslint reverse-proxy/src
