#!/usr/bin/env bash
# Install uv into $INSTALL_DIR (default /usr/local/bin), then use uv to
# install each pinned dev CLI tool listed in DEV_TOOLS. Idempotent — re-running
# upgrades each tool to the pinned version.
#
# To add a tool, append a "<package>==<version>" entry to DEV_TOOLS.
# Args (passed by BUILD.bazel): $1 uv rlocation.
set -euo pipefail

# Pinned dev CLI tools managed by this toolchain.
# Format: "<pypi-name>==<version>".
DEV_TOOLS=(
  "nwave-ai==3.11.0"
)

# --- Bazel bash runfiles initialization (boilerplate from bazel_tools) ---
# shellcheck disable=SC1090
source "${RUNFILES_DIR:-/dev/null}/bazel_tools/tools/bash/runfiles/runfiles.bash" 2>/dev/null \
  || source "$(grep -sm1 "^$0 " "${RUNFILES_MANIFEST_FILE:-/dev/null}" | cut -f2- -d' ')" 2>/dev/null \
  || source "$0.runfiles/bazel_tools/tools/bash/runfiles/runfiles.bash" 2>/dev/null \
  || source "$0.runfiles/MANIFEST" 2>/dev/null \
  || { echo >&2 "ERROR: cannot locate Bazel runfiles library"; exit 1; }
# --- end runfiles boilerplate ---

uv_src=$(rlocation "$1")
[ -x "$uv_src" ] || { echo >&2 "ERROR: binary not executable or missing: $uv_src"; exit 1; }

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

echo "→ installing uv to $INSTALL_DIR"
$SUDO install -m 0755 "$uv_src" "$INSTALL_DIR/uv"

echo ""
echo "→ installing dev CLI tools via uv tool install"
for spec in "${DEV_TOOLS[@]}"; do
  echo "   $spec"
  "$INSTALL_DIR/uv" tool install --force "$spec"
done

echo ""
echo "Installed:"
set +o pipefail
printf "  uv: "; "$INSTALL_DIR/uv" --version 2>/dev/null | head -1
for spec in "${DEV_TOOLS[@]}"; do
  pkg="${spec%%==*}"
  pkg_path=$(command -v "$pkg" 2>/dev/null || true)
  echo "  $spec → ${pkg_path:-(not on PATH; check uv tool dir --bin)}"
done
