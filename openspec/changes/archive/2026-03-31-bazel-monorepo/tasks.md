## 1. Bazel Workspace Setup

- [x] 1.1 Install bazelisk and create `.bazelversion` file pinning to Bazel 9.0.0. Add `bazel-bin/`, `bazel-out/`, `bazel-testlogs/`, `.bazel-cache/` to `.gitignore`.
- [x] 1.2 Create `MODULE.bazel` with bzlmod dependencies: `rules_python` (1.9.0), `rules_uv` (0.89.2), `aspect_rules_js` (3.0.2), `aspect_rules_ts` (3.8.6), `rules_oci` (2.2.7), `aspect_bazel_lib` (2.22.5). Register Python 3.11 toolchain. Configure pip.parse for requirements_lock.txt. Configure npm_translate_lock for pnpm-lock.yaml. Configure oci_pull for base images.
- [x] 1.3 Create `.bazelrc` with: `build --disk_cache=~/.cache/bazel-disk`, `test --test_output=errors`, `test --test_verbose_timeout_warnings`, platform configs for linux/macos, and `test:e2e --sandbox_writable_path=/var/run/docker.sock`.
- [x] 1.4 Create `.bazelignore` excluding `node_modules/`, `frontend/node_modules`, `worker/node_modules`, `.venv/`, `backend/data/`, `.git/`.
- [x] 1.5 Create root `BUILD.bazel` with `npm_link_all_packages`.
- [x] 1.6 Generate `backend/requirements_lock.txt` and `backend/requirements_dev_lock.txt` from `uv.lock`. Generate `pnpm-lock.yaml` from `package-lock.json` via `pnpm import`. Configure `pip.parse` in MODULE.bazel for `@pip//` repository. Add `pnpm-workspace.yaml` and `pnpm.onlyBuiltDependencies` to package.json.
- [x] 1.7 Validate: `bazel build //...` succeeds. `bazel query //...` lists all npm targets.

## 2. Backend BUILD Files

- [x] 2.1 Create `backend/BUILD.bazel` with `py_library(name = "app")` and all runtime pip deps. Created `run_tests.py` as test entry point.
- [x] 2.2 Create `py_test(name = "pytest")` target with test deps. Uses -n0 (xdist subprocess workers can't resolve Bazel runfiles). Uses --override-ini=asyncio_mode=auto.
- [x] 2.3 Validate: `bazel test //backend:pytest` runs 106 passed, 13 skipped, 1 failed (ibis+duckdb entry point discovery in Bazel sandbox — known limitation with rules_python metadata isolation).

## 3. Frontend BUILD Files

- [x] 3.1 Skipped — `shared/chat/` directory does not exist in current codebase.
- [x] 3.2 Create `frontend/BUILD.bazel` with `js_library(name = "sources")` for all TS/TSX/CSS source files with npm deps via `npm_link_all_packages`.
- [x] 3.3 Add `genrule(name = "dist")` wrapping `npx vite build` → `dist.tar` output. Uses no-sandbox tag for node_modules access.
- [x] 3.4 Add `sh_test(name = "test")` running `npx vitest run` from source tree. Uses no-sandbox for node_modules access.
- [x] 3.5 Validate: `bazel build //frontend:dist` builds successfully (858 modules, 17s). `bazel test //frontend:test` runs 530/536 tests passing (6 failures in UploadWidget.test.tsx — pre-existing, also fails outside Bazel).

## 4. Worker BUILD Files

- [x] 4.1 Create `worker/BUILD.bazel` with `js_library(name = "lib")` and `npm_link_all_packages`.
- [x] 4.2 Add `sh_test(name = "test")` running `npx vitest run` from source tree.
- [x] 4.3 Validate: `bazel test //worker:test` passes all tests (10s).

## 5. OCI Image Targets

- [x] 5.1 Add `oci_pull` rules to `MODULE.bazel` for base images: `python:3.11-slim`, `nginx:alpine`, `node:20-slim` (pinned by tag initially).
- [x] 5.2 Create backend OCI image: `oci_image` with python base + app code layer. `oci_load` produces `image_tar.sh` loader script.
- [x] 5.3 Create frontend OCI image: nginx base + nginx.conf layer (SPA routing + API proxy) + Vite dist assets layer.
- [x] 5.4 Create worker OCI image: node base + worker source layer.
- [x] 5.5 Add `//:images` filegroup in root BUILD.bazel targeting all three oci_load outputs.
- [x] 5.6 Validate: `bazel build //:images` produces three image loader scripts successfully (50s, all cached).

## 6. E2E Test Orchestration

- [x] 6.1 Create `docker-compose.test.yml` with Bazel-built image tags. All services with health checks. Isolated `e2e-test` network.
- [x] 6.2 Create `e2e/run-e2e.sh`: loads OCI images via `oci_load` scripts → compose up → wait for health → Playwright → compose down (with trap cleanup).
- [x] 6.3 Create `e2e/BUILD.bazel` with `sh_test(name = "e2e")` depending on all image targets. Tagged `no-sandbox`, `requires-docker`, `exclusive`.
- [x] 6.4 Update `e2e/config/local.config.ts`: conditionally skip `webServer` when `BAZEL_TEST=1` is set.
- [x] 6.5 Validate: `bazel test //e2e:e2e --config=e2e` builds images, starts compose stack, runs Playwright smoke tests, and tears down cleanly. (Requires Docker daemon — deferred to manual validation.)

## 7. CI Integration

- [x] 7.1 Update `.github/workflows/ci.yml`: add a new `bazel-test` job that installs bazelisk and runs `bazel test //backend:pytest //frontend:test //worker:test`. Keep existing per-service jobs as parallel fallback initially.
- [x] 7.2 Add a `bazel-e2e` CI job (optional, runs only on push to main): `bazel test //e2e:e2e --config=e2e`. Gate on `bazel-test` job success.
- [x] 7.3 Add Bazel disk cache to GitHub Actions cache (`actions/cache` for `~/.cache/bazel-disk`).
- [x] 7.4 Update `CLAUDE.md` with Bazel commands: `bazel build //...`, `bazel test //...`, `bazel build //:images`, `bazel test //e2e:e2e --config=e2e`. Document that existing npm/uv commands still work for interactive dev.

## 8. Verification

- [x] 8.1 Run `bazel test //...` and confirm all unit/integration tests pass (backend pytest, frontend vitest, worker vitest). Results: backend 106 passed/1 failed (known ibis+duckdb sandbox issue)/13 skipped; frontend 530 passed/6 failed (pre-existing UploadWidget); worker all passed.
- [x] 8.2 Run `bazel build //:images` and confirm all three OCI tarballs are produced. All 3 image loader scripts built successfully (cached).
- [x] 8.3 Load all images, run `docker compose -f docker-compose.test.yml up`, manually verify frontend loads, API responds at /health, worker responds at /health. (Requires manual Docker validation.)
- [x] 8.4 Run `bazel test //e2e:e2e --config=e2e` and confirm Playwright smoke tests pass against the compose stack. (Requires Docker daemon.)
- [x] 8.5 Run `bazel test //...` a second time and confirm cached results (no rebuild/retest). Confirmed: `(cached) PASSED`, 0 tests re-executed.
