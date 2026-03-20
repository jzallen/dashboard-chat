## Why

Backend Bazel test targets spend 95%+ of wall-clock time on Python startup, imports, and sandbox construction rather than test logic. With 81 targets on 2 CPUs, this overhead compounds and makes the dev inner loop significantly slower than `uv run pytest`. Three targeted interventions can cut wall-clock time substantially without sacrificing correctness or cache granularity.

## What Changes

- Add `--config=dev` spawn strategy to `.bazelrc` that uses local execution (no sandbox) for fast inner-loop iteration; CI retains `--config=ci` sandboxed execution
- Evaluate and adopt `aspect_rules_py` in `MODULE.bazel` to replace the stock `rules_python` symlink forest with a venv, reducing sandbox construction cost
- When `tests/api/` restructure (see `api-test-restructure`) is complete, consolidate API-level test targets into a single `py_test` using `pytest -n auto` internally, so xdist handles parallelism within that suite
- Investigate `--experimental_persistent_workers` compatibility with pytest targets

## Capabilities

### New Capabilities
- `bazel-dev-test-strategy`: Dual spawn strategy configuration (sandboxed for CI, local for dev) with documented usage

### Modified Capabilities
- `bazel-lint-targets`: May need updates if `aspect_rules_py` changes how lint targets are structured

## Impact

- `MODULE.bazel` — new `aspect_rules_py` dependency
- `.bazelrc` — new `--config=dev` profile
- `backend/BUILD.bazel` — API test target consolidation (depends on `api-test-restructure` landing first)
- No application code or production behavior affected
