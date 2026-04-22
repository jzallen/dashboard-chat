## Purpose

Defines the Bazel build surface for the Vite frontend — source library targets, opaque Vite build, Vitest test target, and the nginx-based OCI image. It lets the frontend participate in hermetic monorepo builds alongside the backend and worker.

## Capability: bazel-frontend-build

BUILD files for the React/Vite frontend — source library, Vite build, Vitest tests, and OCI image.

### Behavior

- `js_library(name = "src")` declares all frontend source files and their npm deps
- `js_run_binary(name = "dist")` wraps `vite build` as an opaque build action:
  - Input: all files under `frontend/src/`, `vite.config.ts`, `tsconfig.json`, `tailwind.config.js`, `postcss.config.js`, `index.html`
  - Output: `frontend/dist/` directory
  - Tool: `node_modules/.bin/vite`
  - Env: `NODE_ENV=production`
- `js_test(name = "test")` wraps `vitest run`:
  - Input: all source + test files, vitest.config.ts, test setup
  - Tool: `node_modules/.bin/vitest`
  - Args: `["run"]`
- `oci_image(name = "image")` produces a static hosting image:
  - Base: `nginx:alpine`
  - Layer: nginx.conf (with SPA routing, proxy config)
  - Layer: built dist/ assets
  - Port: 80
- `oci_tarball(name = "image.tar")` for loading into Docker

### Constraints

- Vite build is treated as opaque — entire dist/ rebuilds on any source change
- Path aliases (`@/chat`, `@/auth`, etc.) resolved by Vite, not Bazel
- npm dependencies resolved from root `package-lock.json` via `npm_translate_lock`
- Frontend depends on `//shared/chat:lib` for shared types
- Happy DOM test environment configured via vitest.config.ts, not Bazel
