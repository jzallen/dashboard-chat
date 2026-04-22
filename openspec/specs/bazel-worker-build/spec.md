## Purpose

Defines the Bazel build surface for the Hono/Node.js worker — TypeScript compilation, Vitest execution, and the Node-runtime OCI image. It wires the worker into the shared monorepo build graph together with its `/shared/chat` library dependency.

## Requirements

### Requirement: Worker TypeScript library target

The worker SHALL expose a `ts_project(name = "lib")` target compiling its TypeScript sources and declaring its npm and shared dependencies.

- Inputs SHALL include `index.ts` and all files under `lib/**/*.ts`.
- Dependencies SHALL include `@npm//hono`, `@npm//ioredis`, `@npm//@aws-sdk/client-s3`, `@npm//jose`, and `@npm//eventsource-parser`.
- The target SHALL depend on `//shared/chat:lib` for shared chat code.
- Worker npm dependencies SHALL be resolved from the root `package-lock.json` shared with the frontend.
- Cross-package imports such as `@/raqb` SHALL be expressed via explicit Bazel dependency declarations rather than relying solely on bundler path aliases.

#### Scenario: TypeScript compilation succeeds with shared deps

- **WHEN** `bazel build //worker:lib` is run
- **THEN** the `ts_project` rule SHALL compile `worker/index.ts` and all `worker/lib/**/*.ts`
- **AND** the target SHALL resolve the declared `@npm//...` dependencies and `//shared/chat:lib`
- **AND** imports from `@shared/*` SHALL resolve through the `//shared/chat:lib` dependency

### Requirement: Worker Vitest test target

The worker SHALL expose a `js_test(name = "test")` target that runs `vitest run` over all source and test files.

- Inputs SHALL include all source files, test files, and `vitest.config.ts`.
- The tool SHALL be `node_modules/.bin/vitest`, invoked with `args = ["run"]`.

#### Scenario: Worker tests run under Bazel

- **WHEN** `bazel test //worker:test` is run
- **THEN** Bazel SHALL invoke `node_modules/.bin/vitest run`
- **AND** the worker's TypeScript tests SHALL execute against the compiled worker sources

### Requirement: Worker OCI image

The worker SHALL publish an `oci_image(name = "image")` target producing a Node.js runtime image plus an `oci_tarball(name = "image.tar")` target for Docker loading.

- Base layer SHALL be `node:20-slim`.
- A dependency layer SHALL contain production `node_modules`.
- An application layer SHALL contain the compiled worker source and shared chat code.
- The entrypoint SHALL execute the worker (`node --import tsx worker/index.ts`, or a pre-compiled JavaScript entrypoint if the image is built without `tsx`).
- The image SHALL expose port 8787.

#### Scenario: Worker image starts Hono server

- **WHEN** the worker image is loaded into Docker and started
- **THEN** the container SHALL listen on port 8787
- **AND** the worker's Hono server SHALL handle `/chat` requests

#### Scenario: TypeScript execution strategy is consistent

- **GIVEN** the worker uses `tsx` for TypeScript execution in development
- **WHEN** the OCI image is built
- **THEN** the image SHALL either include `tsx` so the entrypoint runs TypeScript directly, or ship pre-compiled JavaScript that the entrypoint runs with plain `node`
