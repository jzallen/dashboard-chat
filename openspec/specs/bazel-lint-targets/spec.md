## Purpose

Describes the Bazel lint targets (`//frontend:lint`, `//worker:lint`, `//backend:lint`) that wrap ESLint and ruff as `sh_test`s. They give lint the same cacheability and CI enforcement as real tests, replacing ad-hoc shell steps.

## Requirements

### Requirement: Frontend lint runs as a Bazel test target
A `//frontend:lint` `sh_test` target SHALL exist that runs ESLint over `frontend/src` and exits with code 0 when there are no lint errors or warnings.

#### Scenario: Clean frontend sources pass lint target
- **WHEN** `bazel test //frontend:lint` is executed on a codebase with zero ESLint errors
- **THEN** the target exits with code 0 and Bazel reports the test as PASSED

#### Scenario: Frontend lint target fails on ESLint violations
- **WHEN** `bazel test //frontend:lint` is executed on a codebase with ESLint errors
- **THEN** the target exits with a non-zero code and Bazel reports the test as FAILED

#### Scenario: Frontend lint result is cached when sources are unchanged
- **WHEN** `bazel test //frontend:lint` is run twice without modifying any `frontend/src/**/*.ts(x)` file or `eslint.config.js`
- **THEN** the second run uses the cached result and does not re-execute ESLint

#### Scenario: Frontend lint cache is invalidated on source change
- **WHEN** any `frontend/src/**/*.ts` or `frontend/src/**/*.tsx` file is modified
- **THEN** the next `bazel test //frontend:lint` re-executes ESLint rather than using the cached result

### Requirement: Worker lint runs as a Bazel test target
A `//worker:lint` `sh_test` target SHALL exist that runs ESLint over `worker/` sources and exits with code 0 when there are no lint errors or warnings.

#### Scenario: Clean worker sources pass lint target
- **WHEN** `bazel test //worker:lint` is executed on a codebase with zero ESLint errors
- **THEN** the target exits with code 0 and Bazel reports the test as PASSED

#### Scenario: Worker lint target fails on ESLint violations
- **WHEN** `bazel test //worker:lint` is executed on a codebase with ESLint errors
- **THEN** the target exits with a non-zero code and Bazel reports the test as FAILED

#### Scenario: Worker lint cache is invalidated on source change
- **WHEN** any `worker/**/*.ts` file is modified
- **THEN** the next `bazel test //worker:lint` re-executes ESLint rather than using the cached result

### Requirement: Backend lint runs as a Bazel test target
A `//backend:lint` `sh_test` target SHALL exist that runs `ruff check` and `ruff format --check` over `backend/app` and `backend/tests`, exiting with code 0 when both checks pass.

#### Scenario: Clean backend sources pass lint target
- **WHEN** `bazel test //backend:lint` is executed on a codebase where ruff check and ruff format --check both exit 0
- **THEN** the target exits with code 0 and Bazel reports the test as PASSED

#### Scenario: Backend lint target fails on ruff check violations
- **WHEN** `bazel test //backend:lint` is executed and `ruff check` reports violations
- **THEN** the target exits with a non-zero code and Bazel reports the test as FAILED

#### Scenario: Backend lint target fails on ruff format violations
- **WHEN** `bazel test //backend:lint` is executed and `ruff format --check` reports files needing reformatting
- **THEN** the target exits with a non-zero code and Bazel reports the test as FAILED

#### Scenario: Backend lint cache is invalidated on source change
- **WHEN** any `backend/app/**/*.py` or `backend/tests/**/*.py` file is modified
- **THEN** the next `bazel test //backend:lint` re-executes ruff rather than using the cached result

### Requirement: All lint targets are included in `bazel test //...`
The three lint targets (`//frontend:lint`, `//worker:lint`, `//backend:lint`) SHALL be included in the default test suite so that `bazel test //...` covers lint without additional flags.

#### Scenario: `bazel test //...` runs lint
- **WHEN** `bazel test //...` is executed
- **THEN** `//frontend:lint`, `//worker:lint`, and `//backend:lint` are each executed (or their cached results are used)
- **AND** a lint failure causes the overall `bazel test //...` invocation to fail

#### Scenario: Lint targets are not tagged manual
- **WHEN** the lint `sh_test` targets are defined in their respective `BUILD.bazel` files
- **THEN** none of them include `"manual"` in their `tags` attribute

### Requirement: Lint targets are runnable without Bazel for debugging
Each lint shell script (`frontend/lint_test.sh`, `worker/lint_test.sh`, `backend/lint_test.sh`) SHALL be directly executable from the repository root as a convenience for local debugging outside Bazel.

#### Scenario: Direct shell script execution
- **WHEN** a developer runs `bash frontend/lint_test.sh` from the repository root
- **THEN** ESLint executes over `frontend/src` and exits 0 on a clean codebase
