#!/usr/bin/env bash
# Install gh into $INSTALL_DIR (default /usr/local/bin).
# Source is the per-platform binary fetched by Bazel via http_archive.
# Args (passed by BUILD.bazel): $1 gh rlocation.
set -euo pipefail

# --- Bazel bash runfiles initialization (boilerplate from bazel_tools) ---
# shellcheck disable=SC1090
source "${RUNFILES_DIR:-/dev/null}/bazel_tools/tools/bash/runfiles/runfiles.bash" 2>/dev/null \
  || source "$(grep -sm1 "^$0 " "${RUNFILES_MANIFEST_FILE:-/dev/null}" | cut -f2- -d' ')" 2>/dev/null \
  || source "$0.runfiles/bazel_tools/tools/bash/runfiles/runfiles.bash" 2>/dev/null \
  || source "$0.runfiles/MANIFEST" 2>/dev/null \
  || { echo >&2 "ERROR: cannot locate Bazel runfiles library"; exit 1; }
# --- end runfiles boilerplate ---

gh_src=$(rlocation "$1")
[ -x "$gh_src" ] || { echo >&2 "ERROR: binary not executable or missing: $gh_src"; exit 1; }

INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"
mkdir -p "$INSTALL_DIR" 2>/dev/null || true

SUDO=""
if [ ! -w "$INSTALL_DIR" ]; then
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
    echo "→ $INSTALL_DIR is not writable; using sudo"
  else
    echo >&2 "ERROR: $INSTALL_DIR not writable and sudo not available"
    exit 1
  fi
fi

echo "→ installing gh to $INSTALL_DIR"
$SUDO install -m 0755 "$gh_src" "$INSTALL_DIR/gh"

echo ""
echo "Installed:"
set +o pipefail
printf "  gh: "; "$INSTALL_DIR/gh" --version 2>/dev/null | head -1
