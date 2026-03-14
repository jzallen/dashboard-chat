#!/usr/bin/env bash
set -euo pipefail

# ─── E2E Test Runner ─────────────────────────────────────────────────────────
# Loads Bazel-built OCI images, starts docker-compose stack, runs Playwright,
# and tears down on exit.
#
# NOTE: docker-compose.yml uses explicit container_name directives, so the e2e
# stack cannot run alongside a dev stack on the same host.

COMPOSE_FILE="docker-compose.yml"
COMPOSE_PROJECT="e2e-test"

# Determine workspace root
if [[ -n "${BUILD_WORKSPACE_DIRECTORY:-}" ]]; then
    WORKSPACE="$BUILD_WORKSPACE_DIRECTORY"
elif [[ -n "${TEST_SRCDIR:-}" ]]; then
    WORKSPACE="${TEST_SRCDIR}/_main"
else
    WORKSPACE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi

cd "$WORKSPACE"

# Cleanup on exit
cleanup() {
    echo "==> Tearing down e2e stack..."
    docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT" down -v --remove-orphans 2>/dev/null || true
}
trap cleanup EXIT

# ─── Load OCI images ─────────────────────────────────────────────────────────
echo "==> Loading Bazel-built OCI images..."

# oci_load produces shell scripts that call docker load
if [[ -f "bazel-bin/backend/image_tar.sh" ]]; then
    bash bazel-bin/backend/image_tar.sh
    bash bazel-bin/frontend/image_tar.sh
    bash bazel-bin/worker/image_tar.sh
else
    # If running via bazel test, build and load images
    bazel run //backend:image_tar
    bazel run //frontend:image_tar
    bazel run //worker:image_tar
fi

# ─── Start compose stack ──────────────────────────────────────────────────────
echo "==> Starting e2e docker-compose stack..."
AUTH_MODE=dev docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT" up -d

# ─── Wait for services ───────────────────────────────────────────────────────
echo "==> Waiting for services to be healthy..."
MAX_WAIT=120
ELAPSED=0
while [[ $ELAPSED -lt $MAX_WAIT ]]; do
    API_OK=$(curl -sf http://localhost:8000/health >/dev/null 2>&1 && echo "ok" || echo "waiting")
    FRONTEND_OK=$(curl -sf http://localhost:5173/ >/dev/null 2>&1 && echo "ok" || echo "waiting")
    WORKER_OK=$(curl -sf http://localhost:8787/health >/dev/null 2>&1 && echo "ok" || echo "waiting")

    if [[ "$API_OK" == "ok" && "$FRONTEND_OK" == "ok" && "$WORKER_OK" == "ok" ]]; then
        echo "==> All services healthy!"
        break
    fi

    sleep 2
    ELAPSED=$((ELAPSED + 2))
    echo "    Waiting... (api=$API_OK, frontend=$FRONTEND_OK, worker=$WORKER_OK) [${ELAPSED}s]"
done

if [[ $ELAPSED -ge $MAX_WAIT ]]; then
    echo "ERROR: Services did not become healthy within ${MAX_WAIT}s"
    AUTH_MODE=dev docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT" logs
    exit 1
fi

# ─── Run Playwright ───────────────────────────────────────────────────────────
echo "==> Running Playwright tests..."
BAZEL_TEST=1 npx playwright test --config=e2e/config/local.config.ts

echo "==> E2E tests complete!"
