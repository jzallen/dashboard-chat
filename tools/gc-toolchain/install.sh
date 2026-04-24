#!/usr/bin/env bash
# Install gc, dolt, and bd into $INSTALL_DIR (default /usr/local/bin).
# Sources are per-platform binaries fetched by Bazel via http_archive.
# Args (passed by BUILD.bazel): $1 gc rlocation, $2 dolt rlocation, $3 bd rlocation.
set -euo pipefail

# --- Bazel bash runfiles initialization (boilerplate from bazel_tools) ---
# shellcheck disable=SC1090
source "${RUNFILES_DIR:-/dev/null}/bazel_tools/tools/bash/runfiles/runfiles.bash" 2>/dev/null \
  || source "$(grep -sm1 "^$0 " "${RUNFILES_MANIFEST_FILE:-/dev/null}" | cut -f2- -d' ')" 2>/dev/null \
  || source "$0.runfiles/bazel_tools/tools/bash/runfiles/runfiles.bash" 2>/dev/null \
  || source "$0.runfiles/MANIFEST" 2>/dev/null \
  || { echo >&2 "ERROR: cannot locate Bazel runfiles library"; exit 1; }
# --- end runfiles boilerplate ---

gc_src=$(rlocation "$1")
dolt_src=$(rlocation "$2")
bd_src=$(rlocation "$3")

for f in "$gc_src" "$dolt_src" "$bd_src"; do
  [ -x "$f" ] || { echo >&2 "ERROR: binary not executable or missing: $f"; exit 1; }
done

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

echo "→ installing gc, dolt, bd to $INSTALL_DIR"
$SUDO install -m 0755 "$gc_src"   "$INSTALL_DIR/gc"
$SUDO install -m 0755 "$dolt_src" "$INSTALL_DIR/dolt"
$SUDO install -m 0755 "$bd_src"   "$INSTALL_DIR/bd"

echo ""
echo "Installed:"
# Tool banners may span multiple lines; disable pipefail so `head -1` SIGPIPE
# doesn't abort the script under `set -e`.
set +o pipefail
printf "  gc:   "; "$INSTALL_DIR/gc" version 2>/dev/null | head -1
printf "  dolt: "; "$INSTALL_DIR/dolt" version 2>/dev/null | head -1
printf "  bd:   "; "$INSTALL_DIR/bd" --version 2>/dev/null | head -1
