# E2E Tests in CI Pipeline

## Why

End-to-end tests exist in `/e2e/` with Playwright specs covering auth lifecycle (token refresh, activity check), dataset upload, data cleaning, table operations, and smoke tests. But the CI workflow (`.github/workflows/ci.yml`) only runs unit tests — frontend (Vitest), agent (Vitest), backend (pytest), and auth-proxy (Vitest). No e2e job exists.

NFR-B3 was corrected during the docs restructure to acknowledge this: "CI runs unit test suite; e2e runs locally." As the platform adds more cross-service features (report chat tools, planner integration), the risk of regression in service-to-service interactions grows. E2E tests are the only tests that validate the full pipeline: frontend → agent → Groq → backend → MinIO → query engine.

## What Changes

### CI Pipeline
- Add an `e2e` job to `.github/workflows/ci.yml` that:
  1. Builds Docker images (via Bazel or Dockerfile)
  2. Starts Docker Compose services with health check waits
  3. Runs Playwright tests in headless mode
  4. Uploads Playwright HTML report and traces as CI artifacts
  5. Tears down services on completion

### Configuration
- E2E job runs after unit test jobs pass (dependency gate)
- Uses the `local.config.ts` Playwright configuration with CI-appropriate timeouts
- Groq API key provided via GitHub Actions secret (or mock for deterministic tests)
- Services start with `AUTH_MODE=dev` for predictable authentication

### Test Selection (CSV-First Scope)
- **Phase 1 (CSV pipeline):** Smoke spec + dataset-upload specs + data-cleaning specs. These validate the core CSV flow: upload → dataset creation → transform application. This is the initial CI scope.
- **Phase 2 (after report-chat-tools):** Add view and report E2E specs once chat tools for reports land.
- Full e2e suite can run on demand via workflow dispatch or on release branches

## Capabilities

### Modified Capabilities
- `e2e-test-infrastructure`: Extended to include CI execution environment and artifact collection
- `bazel-e2e-orchestration`: If Bazel is used to build images for the e2e job

## Impact

- `.github/workflows/ci.yml` — new `e2e` job (~40-60 lines)
- `e2e/run-e2e.sh` — verify it works in headless CI (no display server)
- `e2e/config/local.config.ts` — may need CI-specific overrides (longer timeouts, retry counts)
- No application code changes
- No database migrations
- CI run time increases by ~3-5 minutes for the e2e job (parallelizable with unit tests)
