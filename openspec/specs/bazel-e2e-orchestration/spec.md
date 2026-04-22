## Purpose

Defines the Bazel-orchestrated end-to-end test target that builds the OCI images, stands up a docker-compose stack, runs Playwright against it, and tears everything down. It is the closed-loop gate for cross-service integration behaviour.

## Requirements

### Requirement: docker-compose test stack

The repository SHALL provide a `docker-compose.test.yml` defining the e2e test stack that runs against Bazel-built images rather than rebuilding from source.

- The `api`, `frontend`, and `worker` services SHALL reference `dashboard-chat/api:bazel`, `dashboard-chat/frontend:bazel`, and `dashboard-chat/worker:bazel` via `image:` (no `build:` directive).
- `redis:7-alpine` and `minio/minio:latest` SHALL be included as supporting services (matching dev).
- Environment variables SHALL match dev defaults (for example, `AUTH_MODE=dev`, SQLite).
- Every service SHALL have a health check.
- The stack SHALL run on an isolated `e2e-test` network.

#### Scenario: Test stack consumes Bazel-built images

- **GIVEN** Bazel-built image tarballs loaded into Docker
- **WHEN** `docker-compose -f docker-compose.test.yml up` is invoked
- **THEN** the `api`, `frontend`, and `worker` services SHALL start from the `dashboard-chat/*:bazel` images without rebuilding from source
- **AND** the stack SHALL be attached to the isolated `e2e-test` network

#### Scenario: Health checks gate readiness

- **WHEN** the test stack starts
- **THEN** each service SHALL expose a health check
- **AND** the e2e runner SHALL wait for all services to report healthy before executing Playwright tests

### Requirement: Bazel e2e test target

`e2e/BUILD.bazel` SHALL define an `sh_test(name = "e2e")` target that loads the Bazel-built images, brings the compose stack up, runs Playwright, and tears the stack down.

- `data` dependencies SHALL include all three `oci_tarball` targets, the Playwright configuration, and the test files.
- The test script SHALL load images, run `docker-compose up`, wait for health, run Playwright, then run `docker-compose down`.
- The test target SHALL carry the tags `no-sandbox`, `requires-docker`, and `exclusive`.
- Timeout SHALL be 300 seconds.
- Test data SHALL be seeded via `e2e/global-setup.ts` (same as the current approach).
- Playwright binary SHALL be available through npm dependencies or a Bazel target.

#### Scenario: e2e target runs the full loop

- **WHEN** `bazel test //e2e:e2e` is run
- **THEN** the test script SHALL load each `oci_tarball` into Docker, bring the compose stack up, wait for health, run Playwright, and bring the stack down
- **AND** the test SHALL honour its 300-second timeout

#### Scenario: Cleanup runs even on failure

- **GIVEN** a test run that fails partway through Playwright execution
- **WHEN** the test script exits or errors
- **THEN** a trap SHALL ensure `docker-compose down` runs so no test stack is left behind

### Requirement: Docker socket access

The e2e test SHALL be granted access to the Docker socket via Bazel sandbox configuration so it can drive docker-compose.

#### Scenario: Sandbox permits docker socket

- **WHEN** the e2e test executes under Bazel
- **THEN** the sandbox SHALL be configured with `--sandbox_writable_path=/var/run/docker.sock`
- **AND** the test SHALL be able to invoke `docker` and `docker-compose` against the host daemon

### Requirement: Exclusive execution

The e2e test SHALL NOT run in parallel with other e2e tests.

#### Scenario: Only one e2e test runs at a time

- **WHEN** Bazel schedules tests
- **THEN** the `//e2e:e2e` target's `exclusive` tag SHALL prevent concurrent execution with any other e2e test
- **AND** Bazel SHALL serialise these tests even when `--jobs` is high
