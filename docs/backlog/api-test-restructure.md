# API Test Restructure

## Context

The backend test suite has overlapping coverage between `tests/routers/` and `tests/integration/`. Router tests exercise route behavior through the FastAPI test client, which is the same thing integration tests do. The `tests/fitness/` directory was an exploratory analysis into serialization patterns and query strategies — those concerns have since been addressed in the main test suite.

Bazel profiling shows individual test files within the same suite have very little variance in execution time (e.g., sql_access targets all cluster at 10-12s), suggesting import overhead dominates. Consolidating around a single `tests/api/` directory reduces confusion about where route-level tests belong.

## Changes

### 1. Rename `tests/integration/` to `tests/api/`

The integration directory currently contains `test_api.py` and `test_upload_pipeline.py`. The name "integration" is too generic — these are API-level tests that exercise route behavior through the FastAPI test client.

### 2. Break down `test_api.py` into resource-oriented test files

`test_api.py` covers multiple resources in a single file. Split into:
- `test_projects.py` — project CRUD routes
- `test_datasets.py` — dataset CRUD routes
- `test_uploads.py` — upload workflow routes (absorb the coverage from the removed `tests/routers/test_uploads_formats.py`)
- `test_reports.py` — report CRUD routes
- `test_views.py` — view CRUD routes
- `test_exports.py` — dbt export routes (absorb the coverage from the removed `tests/routers/test_projects_export.py`)

Each file should include a fitness test class that validates serialization round-trips and response schema conformance for that resource, replacing the removed `tests/fitness/` tests.

### 3. Update BUILD.bazel

Replace `test_integration`, `test_routers`, and `test_fitness` targets with a single `test_api` suite containing per-file targets via the `pytest_tests` macro.

### 4. Absorb router test coverage

The two router test files (`test_projects_export.py`, `test_uploads_formats.py`) test route-level behavior that belongs in the API test suite. Migrate their assertions into the corresponding resource test files in `tests/api/`.

## Non-Goals

- Changing test infrastructure (conftest, fixtures, test client setup)
- Modifying the application code or route definitions
- Adding new test coverage beyond what exists today
