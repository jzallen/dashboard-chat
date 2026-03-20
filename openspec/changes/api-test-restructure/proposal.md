## Why

The backend test suite has overlapping coverage between `tests/routers/` and `tests/integration/`, and `tests/fitness/` contains exploratory work that has since been absorbed. Consolidating into a single `tests/api/` directory with resource-oriented files eliminates ambiguity about where route-level tests live and maps each resource to one test file.

## What Changes

- Rename `tests/integration/` → `tests/api/`
- Split monolithic `test_api.py` into per-resource files: `test_projects.py`, `test_datasets.py`, `test_uploads.py`, `test_reports.py`, `test_views.py`, `test_exports.py`
- Migrate `tests/routers/test_projects_export.py` coverage into `test_exports.py`
- Migrate `tests/routers/test_uploads_formats.py` coverage into `test_uploads.py`
- Remove `tests/routers/` and `tests/fitness/` directories
- Update `backend/BUILD.bazel`: replace `test_integration`, `test_routers`, `test_fitness` targets with a single `test_api` suite via `pytest_tests` macro
- Each resource test file includes a fitness class for serialization round-trip and response schema conformance

## Capabilities

### New Capabilities
- `api-test-structure`: Per-resource API test layout with co-located fitness assertions, replacing the integration/routers/fitness split

### Modified Capabilities

None — no spec-level behavior changes, this is a test organization refactor.

## Impact

- `backend/tests/` — directory structure changes, no application code modified
- `backend/BUILD.bazel` — target names change; CI jobs that reference `test_integration`, `test_routers`, or `test_fitness` by name will need updating
- No API surface, runtime behavior, or production code affected
