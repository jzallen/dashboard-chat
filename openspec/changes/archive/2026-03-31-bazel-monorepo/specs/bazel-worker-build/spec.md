## Capability: bazel-worker-build

BUILD files for the Hono/Node.js worker — TypeScript source, Vitest tests, and OCI image.

### Behavior

- `ts_project(name = "lib")` compiles worker TypeScript source
  - Includes `index.ts`, `lib/**/*.ts`
  - Dependencies: `@npm//hono`, `@npm//ioredis`, `@npm//@aws-sdk/client-s3`, `@npm//jose`, `@npm//eventsource-parser`
  - Depends on `//shared/chat:lib` for shared chat code
- `js_test(name = "test")` wraps `vitest run`:
  - Input: all source + test files, vitest.config.ts
  - Tool: `node_modules/.bin/vitest`
  - Args: `["run"]`
- `oci_image(name = "image")` produces a Node.js runtime image:
  - Base: `node:20-slim`
  - Layer: production node_modules
  - Layer: compiled worker source + shared code
  - Entrypoint: `["node", "--import", "tsx", "worker/index.ts"]` or pre-compiled JS
  - Port: 8787
- `oci_tarball(name = "image.tar")` for loading into Docker

### Constraints

- Worker uses tsx for TypeScript execution — OCI image may need tsx or pre-compilation
- Worker imports from `@/raqb` (frontend path alias) — needs cross-package dep declaration
- Worker imports from `@shared/*` — resolved via `//shared/chat:lib` dep
- npm dependencies from root package-lock.json shared with frontend
