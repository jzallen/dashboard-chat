## Why

Lint runs outside the Bazel graph via npm scripts and uv, requiring a separate CI job and separate local invocations. Adding lint as Bazel targets makes `bazel test //...` the single, complete correctness check — with caching so lint only re-runs when affected files change.

## What Changes

- Add `//frontend:lint` Bazel target — ESLint over `frontend/` sources
- Add `//worker:lint` Bazel target — ESLint over `worker/` sources
- Add `//backend:lint` Bazel target — Ruff check + format check over `backend/` sources
- Include all lint targets under `bazel test //...` (via `testonly` or test-suite grouping)
- Remove the standalone CI `lint` job; the existing `test` job (which runs `bazel test //...`) covers everything

## Capabilities

### New Capabilities
- `bazel-lint-targets`: Lint for all three services (frontend, worker, backend) as Bazel test targets, integrated into `bazel test //...` with incremental caching

### Modified Capabilities
- `code-quality-baseline`: CI invocation path changes — lint is now exercised via `bazel test //...` rather than standalone npm/uv commands. The zero-errors requirement is unchanged; the scenario commands (`uv run ruff check .`, `npx eslint .`) now have Bazel equivalents as the canonical invocation.

## Impact

- **BUILD.bazel files**: `frontend/BUILD.bazel`, `worker/BUILD.bazel`, `backend/BUILD.bazel` — add lint targets
- **`.github/workflows/ci.yml`**: Remove `lint` job; `test` job already runs `bazel test //...`
- **`MODULE.bazel`**: Possibly add `aspect-build/rules_lint` Bazel module dep, or use `genrule`-based approach
- **`package.json`**: npm lint scripts remain for convenience but are no longer the CI authority
- **No runtime behavior changes**: lint targets are build-time only
