## Purpose

Defines the Bazel build surface for the Vite frontend — source library targets, opaque Vite build, Vitest test target, and the nginx-based OCI image. It lets the frontend participate in hermetic monorepo builds alongside the backend and worker.

## Requirements

### Requirement: Frontend source library target

The frontend SHALL expose a `js_library(name = "src")` target declaring all frontend source files and their npm dependencies, sourced from the root `package-lock.json` via `npm_translate_lock`.

- Frontend npm dependencies SHALL be resolved from the root `package-lock.json` via `npm_translate_lock`.
- The library SHALL depend on `//shared/chat:lib` for shared types used between the frontend and the worker.

#### Scenario: Source library resolves shared types and npm deps

- **WHEN** `bazel build //frontend:src` is run
- **THEN** all source files under `frontend/src/` SHALL be included in the library
- **AND** npm dependencies SHALL resolve from the root `package-lock.json`
- **AND** the target SHALL depend on `//shared/chat:lib` for shared types

### Requirement: Opaque Vite build target

The frontend SHALL expose a `js_run_binary(name = "dist")` target that wraps `vite build` as an opaque action producing the `frontend/dist/` directory.

- Inputs SHALL include all files under `frontend/src/`, `vite.config.ts`, `tsconfig.json`, `tailwind.config.js`, `postcss.config.js`, and `index.html`.
- The tool SHALL be `node_modules/.bin/vite`.
- The build SHALL run with `NODE_ENV=production`.
- The entire `dist/` directory SHALL rebuild on any source change (the Vite build is treated as opaque to Bazel).
- Path aliases such as `@/chat` and `@/auth` SHALL be resolved by Vite rather than Bazel.

#### Scenario: Vite build produces dist/ from declared inputs

- **WHEN** `bazel build //frontend:dist` is run
- **THEN** Bazel SHALL invoke `node_modules/.bin/vite build` with `NODE_ENV=production`
- **AND** the output SHALL be the `frontend/dist/` directory populated with the Vite production build
- **AND** changes to any declared input SHALL trigger a full rebuild of `dist/`

### Requirement: Vitest test target

The frontend SHALL expose a `js_test(name = "test")` target that wraps `vitest run` over all source and test files.

- Inputs SHALL include all source files, test files, `vitest.config.ts`, and any referenced test setup file.
- The tool SHALL be `node_modules/.bin/vitest`, invoked with `args = ["run"]`.
- The Happy DOM test environment SHALL be configured via `vitest.config.ts`, not via Bazel attributes.

#### Scenario: Bazel runs Vitest in CI

- **WHEN** `bazel test //frontend:test` is run
- **THEN** Bazel SHALL invoke `node_modules/.bin/vitest run`
- **AND** tests SHALL execute under the Happy DOM environment configured in `vitest.config.ts`

### Requirement: Frontend OCI image

The frontend SHALL publish an `oci_image(name = "image")` target producing a static hosting image plus an `oci_tarball(name = "image.tar")` target for Docker loading.

- Base layer SHALL be `nginx:alpine`.
- A configuration layer SHALL contain a custom `nginx.conf` implementing SPA fallback routing and proxy configuration.
- An assets layer SHALL contain the Vite build output (`dist/`).
- The image SHALL expose port 80.

#### Scenario: nginx image serves built assets

- **WHEN** the frontend image is built and loaded into Docker
- **THEN** the resulting container SHALL start nginx on port 80
- **AND** nginx SHALL serve the contents of the Vite `dist/` assets layer
- **AND** unknown routes SHALL fall back to `index.html` per the SPA configuration
