#!/usr/bin/env bash
set -euo pipefail

# ─── E2E Test Runner ─────────────────────────────────────────────────────────
# Loads Bazel-built OCI images, starts docker-compose stack, runs Playwright,
# and tears down on exit.

COMPOSE_FILE="docker-compose.test.yml"
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
docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT" up -d

# ─── Wait for services ───────────────────────────────────────────────────────
echo "==> Waiting for services to be healthy..."
MAX_WAIT=120
ELAPSED=0
while [[ $ELAPSED -lt $MAX_WAIT ]]; do
    API_HEALTHY=$(docker inspect --format='{{.State.Health.Status}}' e2e-api 2>/dev/null || echo "starting")
    FRONTEND_HEALTHY=$(docker inspect --format='{{.State.Health.Status}}' e2e-frontend 2>/dev/null || echo "starting")

    if [[ "$API_HEALTHY" == "healthy" && "$FRONTEND_HEALTHY" == "healthy" ]]; then
        echo "==> All services healthy!"
        break
    fi

    sleep 2
    ELAPSED=$((ELAPSED + 2))
    echo "    Waiting... (api=$API_HEALTHY, frontend=$FRONTEND_HEALTHY) [${ELAPSED}s]"
done

if [[ $ELAPSED -ge $MAX_WAIT ]]; then
    echo "ERROR: Services did not become healthy within ${MAX_WAIT}s"
    docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT" logs
    exit 1
fi

# ─── Run Playwright ───────────────────────────────────────────────────────────
echo "==> Running Playwright tests..."
BAZEL_TEST=1 npx playwright test --config=e2e/config/local.config.ts

echo "==> E2E tests complete!"
