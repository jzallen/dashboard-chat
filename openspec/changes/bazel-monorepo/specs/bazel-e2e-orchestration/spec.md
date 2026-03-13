## Capability: bazel-e2e-orchestration

E2E test target that builds OCI images, starts a docker-compose stack, runs Playwright, and tears down.

### Behavior

- `docker-compose.test.yml` defines the test stack:
  - `api` service: `image: dashboard-chat/api:bazel` (no `build:` directive)
  - `frontend` service: `image: dashboard-chat/frontend:bazel` (nginx serving built assets)
  - `worker` service: `image: dashboard-chat/worker:bazel`
  - `redis`: `redis:7-alpine` (same as dev)
  - `minio`: `minio/minio:latest` (same as dev)
  - Environment variables match dev defaults (AUTH_MODE=dev, SQLite, etc.)
  - Health checks on all services
  - Network: isolated `e2e-test` network
- `sh_test(name = "e2e")` in `e2e/BUILD.bazel`:
  - `data` deps include all three `oci_tarball` targets + Playwright config + test files
  - Test script: loads images → compose up → wait for health → run Playwright → compose down
  - Tagged `no-sandbox`, `requires-docker`, `exclusive` (no parallel with other tests)
  - Timeout: 300 seconds
- Cleanup guaranteed via trap in test script (compose down on exit/error)

### Constraints

- Requires Docker socket access (`--sandbox_writable_path=/var/run/docker.sock`)
- Cannot run in parallel with other e2e tests (`exclusive` tag)
- MinIO and Redis use standard images (not Bazel-built)
- Test data seeded via `e2e/global-setup.ts` (same as current approach)
- Playwright binary must be available (installed via npm deps or Bazel target)
