# Bazel Python Test Performance

## Context

Backend Bazel test targets spend 95%+ of execution time on Python startup, imports, and sandbox construction — not actual test logic. Profiling shows:

| Cost layer | Per-target | % of total |
|-----------|-----------|-----------|
| Python startup + imports | 5-10s | ~60% |
| Sandbox symlink forest | 2-5s | ~30% |
| moto mock_aws entry | 0.3-1.2s | ~8% |
| Actual test logic | <0.5s | ~2% |

With 81 test targets on 2 CPUs, this import/sandbox overhead dominates wall-clock time. The core tension: Bazel's per-target isolation model is expensive for Python because each `py_test` is a fresh process that re-imports everything through a symlink-based runfiles tree.

### What's already been done

- Lazy imports for `app.types`, `app.database`, `app.utils.sql_functions` — defers ibis/pydantic_settings to first use
- Dependency splitting (`:core` → `:core` + `:exceptions` + `:utils`) — narrower invalidation
- Session-scoped test fixtures — moto and db engine created once per process, per-test isolation via SAVEPOINT rollback
- Result: `uv run pytest` dropped from 144s to 69s; `test_pagination` (Bazel) dropped from 5.3s to 1.0s

## 1. Migrate to `aspect_rules_py`

`aspect_rules_py` replaces the stock `rules_python` symlink forest with a proper venv, which directly attacks the two biggest costs:

- **Faster sandbox construction** — venv instead of massive symlink tree
- **Correct namespace package handling** — no `.pth` file / `__init__.py` edge cases
- **Compatible with standard pytest plugins** including xdist

```python
# MODULE.bazel
bazel_dep(name = "aspect_rules_py", version = "0.7.4")
```

Investigate whether our `pytest_tests` macro and per-file target pattern work with `aspect_rules_py`'s venv approach without modification.

## 2. Dual spawn strategy in `.bazelrc`

Sandbox enforcement matters for CI reproducibility but is expensive for the dev inner loop. Add strategy configs:

```
# CI (hermetic — default)
build:ci --spawn_strategy=sandboxed

# Dev (fast inner loop)
build:dev --spawn_strategy=local --strategy=TestRunner=local
```

Usage: `bazel test //backend:tests --config=dev` for fast iteration. CI enforces `--config=ci`. This retains dependency graph validation and remote caching while removing sandbox overhead during development.

## 3. Persistent workers for Python

Bazel's `--experimental_persistent_workers` flag keeps worker processes alive across test invocations, amortizing Python startup and import cost. Investigate compatibility with `rules_python` / `aspect_rules_py` pytest targets.

## 4. xdist within integration test targets

When `tests/integration/` is restructured into `tests/api/` (see `api-test-restructure.md`), API-level tests could run as a single `py_test` target using `pytest -n auto` internally. These tests share the same app setup and change infrequently, so per-file Bazel caching provides little benefit. This hands parallelism to xdist within the target while Bazel still caches the aggregate result.

Unit tests should stay as per-file targets — they benefit from granular caching and the import overhead is lower (narrower deps).

## Trade-off Summary

| Approach | Correctness | Dev speed | Cache granularity |
|----------|-------------|-----------|-------------------|
| Current (sandbox, per-file targets) | High | Slow | Per-file |
| `aspect_rules_py` + sandbox | High | Medium | Per-file |
| `--spawn_strategy=local` for dev | Lower (dev only) | Fast | Per-file |
| xdist within integration targets | High | Fast | Per-suite |
| Persistent workers | High | Medium-Fast | Per-file |

Recommended priority: (2) dual strategy is a one-line change, (1) `aspect_rules_py` is the highest-impact migration, (4) ties into the API test restructure, (3) is experimental and can wait.
