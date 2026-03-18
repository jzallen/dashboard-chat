## Context

Dashboard Chat is a three-service monorepo: React/Vite frontend, FastAPI/SQLAlchemy backend, Hono/Node.js worker. Each service has its own build toolchain (Vite, uv, tsx), test runner (Vitest, pytest, Vitest), and containerization approach (Dockerfile for backend, node:20-alpine with volume mounts for frontend/worker).

The current setup is not hermetic: docker-compose runs `npm install` at container start, frontend/worker mount source directly, and e2e tests run against dev servers. Bazel will provide hermetic, cached, reproducible builds for all services and produce OCI images suitable for both e2e testing and production deployment.

## Goals / Non-Goals

**Goals:**
- Unified `bazel build //...` and `bazel test //...` commands for all services
- Hermetic builds: all dependencies resolved at analysis time, sandboxed execution
- Content-addressed local disk cache (no remote cache initially)
- OCI images with optimized layers (base → deps → app) for fast rebuilds
- E2e tests run against Bazel-built OCI images via docker-compose
- Existing dev tooling (Vite HMR, `uv run`, `tsx --watch`) remains functional

**Non-Goals:**
- Remote build cache (BuildBuddy, EngFlow) — deferred
- Remote build execution (RBE) — deferred
- Replacing Vite with Bazel-native bundling (esbuild/swc) — Vite stays as black-box build
- Fine-grained frontend compilation caching — Vite build is an opaque action
- Bazel-managed dev servers or HMR — separate development path

## Decisions

### D1: Bzlmod (MODULE.bazel) over WORKSPACE

**Decision**: Use Bazel's bzlmod system (MODULE.bazel) instead of the legacy WORKSPACE file.

**Rationale**: WORKSPACE is deprecated. Bzlmod provides better dependency resolution, version conflict management, and is the future of Bazel. All modern rulesets (rules_python, rules_js, rules_oci) support bzlmod.

### D2: rules_uv for Python dependency management

**Decision**: Use `rules_uv` to parse `backend/uv.lock` directly for hermetic Python dependency resolution, rather than `rules_python`'s pip_parse.

**Rationale**: The project already uses uv with a committed `uv.lock`. `rules_uv` natively understands this lockfile format, avoiding a lossy conversion to requirements.txt. It produces the same hermetic pip repository as `pip_parse` but from the existing lockfile.

**Alternative considered**: `rules_python` + `pip_parse` with a generated `requirements_lock.txt`. Rejected because it adds a derived lockfile that must stay in sync with `uv.lock`.

### D3: Vite as opaque build action via js_run_binary

**Decision**: Wrap `vite build` as a `js_run_binary` Bazel action with glob inputs and dist/ output. Do not attempt to decompose the Vite build into fine-grained Bazel targets.

**Rationale**: Vite's plugin pipeline (React, Tailwind, PostCSS, path aliases) is deeply integrated and not decomposable into individual Bazel actions without rewriting the build. The frontend is a single "compilation unit" from Bazel's perspective. This means any frontend source change rebuilds the entire dist/, but Vite builds are fast (~5s) and the OCI image layer for the built assets is small.

**Alternative considered**: Replace Vite with esbuild/swc rules for fine-grained caching. Rejected — massive migration cost, loss of Vite plugin ecosystem, not justified for current build times.

### D4: Vitest wrapped via js_test

**Decision**: Run Vitest via `js_test` with `vitest run` as the entry point. Test targets are coarse-grained (one target per service, not per-file).

**Rationale**: Vitest has its own module resolution, config, and setup files. Per-file targets would require declaring every import relationship in BUILD files — high maintenance for marginal caching benefit. Coarse targets (//frontend:test, //worker:test) match the current CI granularity and are sufficient for local disk caching.

**Alternative considered**: Per-file `js_test` targets. Rejected due to the maintenance burden of declaring inter-file deps and Vitest config plumbing per target.

### D5: pytest via py_test with conftest

**Decision**: Run pytest as a single `py_test` target per test directory (or as one target for all backend tests), with `conftest.py` fixtures included in `data`.

**Rationale**: pytest's fixture injection (conftest.py at multiple directory levels), xdist parallelization, and auto-mode asyncio make per-file test targets impractical. The conftest.py fixtures create database sessions and mock S3 — these are not easily decomposable. A single `py_test(name = "tests", ...)` target with `pytest -n auto` inside the sandbox achieves hermeticity.

**Alternative considered**: Per-directory `py_test` targets. May be explored later for caching benefits, but adds complexity in conftest.py dependency declarations.

### D6: OCI images via rules_oci with layered tarballs

**Decision**: Build OCI images using `rules_oci` (`oci_image` + `oci_tarball`) instead of Dockerfiles. Images are layered for cache efficiency:

```
Backend image layers:
  1. python:3.11-slim (base)
  2. System packages: build-essential, libpq-dev, curl
  3. Python packages from uv.lock (changes rarely)
  4. Application code (changes frequently)
  5. Entrypoint configuration

Frontend image layers:
  1. nginx:alpine (base)
  2. nginx.conf
  3. Built static assets from dist/ (output of Vite build)

Worker image layers:
  1. node:20-slim (base)
  2. node_modules from package-lock.json (changes rarely)
  3. Application TypeScript + shared code (changes frequently)
  4. Entrypoint: node/tsx index.ts
```

**Rationale**: `rules_oci` produces byte-identical images regardless of build host or time. Layers are independently cached — a code-only change only rebuilds the top layer. Images can be loaded into Docker via `oci_tarball` for docker-compose compatibility.

### D7: docker-compose.test.yml for e2e

**Decision**: Create a separate `docker-compose.test.yml` that references Bazel-built OCI tarballs loaded into the local Docker daemon. The e2e Bazel target:
1. Builds all three OCI tarballs
2. Loads them via `docker load`
3. Runs `docker compose -f docker-compose.test.yml up -d`
4. Runs Playwright against the compose stack
5. Tears down

**Rationale**: docker-compose is the existing orchestration tool and handles networking, health checks, and service dependencies. Replacing it with a Bazel-native orchestrator would be reinventing the wheel. The test variant uses fixed image tags (e.g., `dashboard-chat/api:bazel`) instead of `build:` directives.

**Alternative considered**: Bazel-native service orchestration via `sh_test` with manual container management. Rejected — docker-compose already handles health checks, networking, and cleanup.

### D8: Parallel development paths (Bazel builds vs. dev servers)

**Decision**: Keep both paths:
- `bazel build/test` — for CI, e2e, and production image creation
- `npm run dev` / `uv run uvicorn` / `docker compose up` — for interactive development with HMR

**Rationale**: Bazel's sandboxing model doesn't support file watching or HMR. Developers need fast feedback loops during active coding. The existing docker-compose.yml (with volume mounts and `--watch`/`--reload`) serves this purpose. Bazel serves the "verify everything works together" purpose.

### D9: .bazelrc configuration

**Decision**: Configure .bazelrc with:
- `--disk_cache=~/.cache/bazel-disk` for local caching
- `--sandbox_writable_path=/var/run/docker.sock` for e2e tests needing Docker
- `--test_output=errors` for readable test failure output
- Platform-specific configs for Linux (CI) vs. macOS (dev)

## Risks / Trade-offs

**[Bazel learning curve]** — Bazel has a steep learning curve. BUILD file debugging, sandbox escapes, and toolchain issues can consume significant time. **Mitigation**: Keep BUILD files simple (coarse-grained targets), document common operations in CLAUDE.md, rely on AI assistance for BUILD file generation.

**[Node.js rules maturity]** — `rules_js` and `rules_ts` from Aspect are well-maintained but occasionally have edge cases with complex node_modules layouts. **Mitigation**: Use `js_run_binary` for complex tools (Vite, Vitest) that need full node_modules access rather than trying to declare fine-grained deps.

**[Docker-in-Bazel sandbox]** — E2E tests need Docker socket access inside Bazel's sandbox. This is technically a sandbox escape. **Mitigation**: Only the e2e test target needs this; mark it with `tags = ["no-sandbox", "requires-docker"]`. Unit/integration tests remain fully sandboxed.

**[Dual build system maintenance]** — Maintaining both Bazel BUILD files and existing package.json/pyproject.toml configs creates a sync burden. **Mitigation**: Bazel reads the existing lockfiles (uv.lock, package-lock.json) directly — dependency declarations stay in one place. BUILD files only declare source structure and targets, not dependencies.

**[Frontend rebuild granularity]** — Any frontend source change triggers a full Vite rebuild in Bazel (opaque action). **Mitigation**: Vite builds are fast (~5s). The Bazel cache prevents unnecessary rebuilds when nothing changed. This is acceptable for CI; developers use HMR for fast iteration.

**[rules_uv version stability]** — `rules_uv` is relatively new. **Mitigation**: Pin to a known-good version. Fallback plan is `rules_python` + `pip_parse` with a generated requirements.txt.

## Migration Plan

1. **Phase 1 — Workspace setup** (Tasks 1.x): MODULE.bazel, .bazelrc, toolchain registration. Validate `bazel build //...` produces no errors (even with no targets).

2. **Phase 2 — Backend targets** (Tasks 2.x): py_library and py_test for backend. Validate `bazel test //backend/...` runs pytest hermetically. This is the easiest service to Bazelize.

3. **Phase 3 — Frontend/Worker/Shared targets** (Tasks 3.x): js_library, ts_project, js_test, js_run_binary for Vite. Validate `bazel test //frontend/... //worker/...` and `bazel build //frontend:dist`.

4. **Phase 4 — OCI images** (Tasks 4.x): oci_image targets for all three services. Validate images run correctly via `docker run`.

5. **Phase 5 — E2E orchestration** (Tasks 5.x): docker-compose.test.yml, e2e test target. Validate `bazel test //e2e:smoke` runs Playwright against Bazel-built images.

6. **Phase 6 — CI integration** (Tasks 6.x): Update GitHub Actions to use `bazel test //...`. Keep existing jobs as fallback initially.

Each phase is independently valuable and can be merged separately. Phase 2 alone gives hermetic backend tests. Phase 4 alone gives deterministic images.

## Open Questions

1. **npm workspace vs pnpm**: `rules_js` works best with pnpm lockfiles. Should we convert `package-lock.json` to `pnpm-lock.yaml`, or use the npm_translate_lock adapter? The adapter works but is less battle-tested.

2. **Worker runtime in OCI**: The worker currently uses `tsx` (TypeScript execution without compilation). In the OCI image, should we pre-compile to JS via `tsc` or bundle via esbuild, or ship tsx in the image?

3. **Shared code packaging**: `shared/chat/` is not currently an npm workspace. Should it become a proper Bazel package (ts_project), or be inlined into both consumers?

4. **Bazel version pinning**: Use `.bazelversion` file + bazelisk? This is standard practice but needs to be documented.
