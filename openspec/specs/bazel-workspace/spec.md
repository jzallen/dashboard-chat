## Purpose

Defines the root Bazel workspace via `MODULE.bazel` (bzlmod), registering the Python 3.11 and Node.js 20 toolchains and the rulesets every service build depends on. It is the foundational layer every Bazel target in the repo sits on top of.

## Requirements

### Requirement: bzlmod module declaration

The root Bazel workspace SHALL be defined via `MODULE.bazel` using bzlmod and SHALL declare the rulesets every service build depends on: `rules_python`, `rules_uv`, `rules_js`, `rules_ts`, `rules_oci`, and `aspect_bazel_lib`. No `WORKSPACE` file SHALL be used.

#### Scenario: Workspace declares required rulesets via bzlmod

- **GIVEN** the repository root
- **WHEN** Bazel loads the module graph
- **THEN** `MODULE.bazel` SHALL declare `bazel_dep` entries for `rules_python`, `rules_uv`, `rules_js`, `rules_ts`, `rules_oci`, and `aspect_bazel_lib`
- **AND** no legacy `WORKSPACE` file SHALL be present

### Requirement: Pinned ruleset versions

All rulesets referenced from `MODULE.bazel` SHALL be pinned to specific versions so that builds are reproducible across machines.

#### Scenario: Every ruleset is version-pinned

- **WHEN** `MODULE.bazel` is inspected
- **THEN** every `bazel_dep` entry SHALL include an explicit `version = "..."` argument
- **AND** no entry SHALL rely on a floating or unpinned version selector

### Requirement: Python toolchain via rules_uv

A Python 3.11 toolchain SHALL be registered via `rules_uv`, resolving pip dependencies hermetically from `backend/uv.lock`.

#### Scenario: Python toolchain resolves from uv.lock

- **GIVEN** `backend/uv.lock` exists at the repo root
- **WHEN** Bazel resolves Python dependencies
- **THEN** `rules_uv` SHALL be used to register the Python 3.11 toolchain
- **AND** pip dependencies SHALL be resolved exclusively from `backend/uv.lock`

### Requirement: Node.js toolchain via rules_js

A Node.js 20 toolchain SHALL be registered via `rules_js`, resolving npm dependencies from the root `package-lock.json`.

#### Scenario: Node toolchain uses root package-lock.json

- **GIVEN** a root `package-lock.json`
- **WHEN** Bazel resolves JavaScript dependencies
- **THEN** `rules_js` SHALL be used to register the Node.js 20 toolchain
- **AND** npm dependencies SHALL be translated from the root `package-lock.json`

### Requirement: Build configuration files

The workspace SHALL provide `.bazelrc`, `.bazelversion`, a root `BUILD.bazel`, and `.bazelignore` to configure local cache, pin the Bazel version, expose top-level aliases, and exclude generated directories.

- `.bazelrc` SHALL configure a local disk cache, sandbox defaults, and test output formatting.
- `.bazelversion` SHALL pin the Bazel version for bazelisk.
- The root `BUILD.bazel` SHALL define top-level aliases, including `//:build-all` and `//:test-all`.
- `.bazelignore` SHALL exclude at least `node_modules/`, `.venv/`, `backend/data/`, and `.git/`.

#### Scenario: Top-level aliases build and test everything

- **WHEN** a developer runs `bazel build //:build-all` or `bazel test //:test-all`
- **THEN** the root `BUILD.bazel` aliases SHALL fan out to the backend, frontend, and worker targets

#### Scenario: Generated directories are ignored

- **WHEN** Bazel scans for BUILD files
- **THEN** `.bazelignore` SHALL prevent traversal into `node_modules/`, `.venv/`, `backend/data/`, and `.git/`

### Requirement: Local cache only

The workspace SHALL rely on a local disk cache only; no remote cache configuration SHALL be committed.

#### Scenario: No remote cache configured

- **WHEN** `.bazelrc` is inspected
- **THEN** it SHALL configure `--disk_cache=...` for local caching
- **AND** it SHALL NOT configure a `--remote_cache` endpoint

### Requirement: Cross-platform support

The workspace SHALL build successfully on Linux (CI) and macOS (developer machines), with any platform-specific settings expressed via `.bazelrc` configs rather than code paths.

#### Scenario: Linux and macOS builds share the same workspace

- **GIVEN** a clean checkout
- **WHEN** `bazel build //:build-all` is run on Linux CI or on a macOS developer machine
- **THEN** the build SHALL succeed using the same `MODULE.bazel`
- **AND** any platform-specific overrides SHALL be supplied via `.bazelrc` config groups
