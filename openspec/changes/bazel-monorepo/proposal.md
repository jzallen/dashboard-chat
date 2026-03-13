## Why

E2E tests are flaky due to non-hermetic builds — dev servers serve as test targets, dependencies are resolved at runtime (`npm install` in docker-compose commands), and there's no guarantee that what's tested locally matches what CI or production builds produce. The three-service monorepo (React/Vite frontend, FastAPI backend, Hono worker) uses three different build/test systems (Vite/Vitest, uv/pytest, tsx/Vitest) with three different dependency managers. This makes both human and AI-driven development harder: every service has different incantations for install, build, test, and image creation.

Adopting Bazel as the unified build system provides hermetic builds, content-addressed caching, and a single CLI interface (`bazel build`, `bazel test`) for all services. OCI images built by Bazel are deterministic and layer-optimized, enabling reliable e2e testing against production-equivalent artifacts.

## What Changes

- **Add Bazel workspace configuration** (`MODULE.bazel`, `.bazelrc`) with `rules_python`, `rules_uv`, `rules_js`, `rules_ts`, `rules_oci`, and `aspect_bazel_lib` as dependencies
- **Add BUILD files for backend**: `py_library` targets for app code, `py_test` targets for pytest suite, `oci_image` target producing a layered Python image (base → system deps → pip packages → app code)
- **Add BUILD files for frontend**: `js_library` for source, `js_test` wrapping Vitest, `js_run_binary` wrapping Vite build, `oci_image` target serving static dist via nginx
- **Add BUILD files for worker**: `ts_project` for source, `js_test` wrapping Vitest, `oci_image` target for Node.js runtime
- **Add BUILD file for shared/chat**: `ts_project` target consumed as a dep by frontend and worker
- **Add BUILD file for e2e**: Test target that depends on all three OCI images, orchestrates via docker-compose, runs Playwright
- **Add `docker-compose.test.yml`**: Variant that references Bazel-built OCI images (loaded via `oci_tarball`) instead of building from Dockerfiles or mounting source
- **Update CI workflow** to use `bazel test //...` instead of per-service test commands
- **Keep existing tooling** (Vite, uv, npm, Turbo) for interactive development — Bazel is for builds and CI, not HMR

## Capabilities

### New Capabilities
- `bazel-workspace`: MODULE.bazel, .bazelrc, toolchain registration, and root BUILD file defining top-level aliases
- `bazel-backend-build`: BUILD files for Python backend — library, test, and OCI image targets
- `bazel-frontend-build`: BUILD files for frontend — Vite build wrapper, Vitest wrapper, and OCI image target
- `bazel-worker-build`: BUILD files for worker — TypeScript compilation, Vitest wrapper, and OCI image target
- `bazel-oci-images`: OCI image targets for all three services, layered for cache efficiency, compatible with docker-compose
- `bazel-e2e-orchestration`: E2E test target that spins up OCI images via docker-compose and runs Playwright

### Modified Capabilities
- CI pipeline updated to use `bazel test //...` as the primary test command

## Impact

- **Root directory**: New MODULE.bazel, .bazelrc, BUILD.bazel files
- **Backend**: BUILD.bazel files in backend/, backend/app/, backend/tests/
- **Frontend**: BUILD.bazel files in frontend/, frontend/src/
- **Worker**: BUILD.bazel files in worker/, worker/lib/
- **Shared**: BUILD.bazel in shared/chat/
- **E2E**: BUILD.bazel in e2e/, new docker-compose.test.yml
- **CI**: Updated .github/workflows/ci.yml
- **Existing tooling**: Unchanged — Vite, uv, npm, Turbo continue to work for interactive dev
- **Docker Compose**: Existing docker-compose.yml unchanged; new test variant added
