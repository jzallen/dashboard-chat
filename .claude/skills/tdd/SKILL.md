---
name: tdd
description: Use when running tests for specific files or modules. Maps source files to the correct Bazel test target or direct test command, so you run only what's needed instead of the full suite.
---

# Test-Driven Development — Targeted Test Execution

## Workflow

Before editing any source file:
1. Identify the related test file(s)
2. Run the targeted test(s) to confirm they pass
3. Make the edit
4. Re-run the same targeted test(s) to confirm nothing broke

After all edits are complete, run the full affected-service test suite as a final check.

## Mapping Source Files to Bazel Test Targets

### Backend (`backend/`)

Each test directory maps to a Bazel target:

| Source path | Test directory | Bazel target |
|---|---|---|
| `app/auth/` | `tests/auth/` | `//backend:test_auth` |
| `app/controllers/` | `tests/controllers/` | `//backend:test_controllers` |
| `app/models/` | `tests/models/` | `//backend:test_models` |
| `app/repositories/` | `tests/repositories/` | `//backend:test_repositories` |
| `app/use_cases/dataset/` | `tests/use_cases/dataset/` | `//backend:test_uc_dataset` |
| `app/use_cases/project/` | `tests/use_cases/project/` | `//backend:test_uc_project` |
| `app/use_cases/project_dbt/` | `tests/use_cases/project_dbt/` | `//backend:test_uc_project_dbt` |
| `app/use_cases/report/` | `tests/use_cases/report/` | `//backend:test_uc_report` |
| `app/use_cases/sql_access/` | `tests/use_cases/sql_access/` | `//backend:test_uc_sql_access` |
| `app/use_cases/upload/` | `tests/use_cases/upload/` | `//backend:test_uc_upload` |
| `app/use_cases/view/` | `tests/use_cases/view/` | `//backend:test_uc_view` |
| `app/use_cases/organization/` | `tests/use_cases/organization/` | `//backend:test_uc_organization` |
| `app/plugins/` | `tests/plugins/` | `//backend:test_plugins` |
| `app/utils/` | `tests/utils/` | `//backend:test_utils` |
| cross-cutting / integration | `tests/integration/` | `//backend:test_integration` |

Run a single target:
```bash
bazel test //backend:test_auth
```

Run a single test file via pytest (faster iteration):
```bash
cd backend && uv run pytest tests/auth/test_providers.py -x -q
```

Run a single test function:
```bash
cd backend && uv run pytest tests/auth/test_providers.py -k test_dev_provider -x -q
```

Run all backend tests:
```bash
bazel test //backend:tests
```

### Frontend (`frontend/`)

Each vitest config covers a module group:

| Source path | Bazel target |
|---|---|
| `src/lib/api/`, `src/lib/` (non-UI) | `//frontend:test_lib` |
| `src/lib/auth/` | `//frontend:test_core_auth` |
| `src/lib/ui/context/` (chat) | `//frontend:test_core_chat` |
| `src/lib/ui/` (data catalog) | `//frontend:test_core_datacatalog` |
| `src/lib/table-tools/` | `//frontend:test_core_toolcalls` |
| `src/lib/ui/hooks/` | `//frontend:test_ui_hooks` |
| `src/lib/ui/context/` (non-chat) | `//frontend:test_ui_context` |
| `src/lib/ui/components/` | `//frontend:test_ui_components` |

Run a single target:
```bash
bazel test //frontend:test_core_auth
```

Run a single test file directly (faster iteration):
```bash
cd frontend && npx vitest run src/lib/auth/AuthProvider.test.tsx
```

Run all frontend tests:
```bash
bazel test //frontend:test
```

### Worker (`worker/`)

Single test target:
```bash
bazel test //worker:test
# or directly:
npm run test:worker
```

### Shared (`shared/`)

Changes to `shared/chat/` affect both frontend and worker — run both:
```bash
bazel test //frontend:test //worker:test
```

## Full Suite (final verification)

```bash
bazel test //...                    # everything (backend + frontend + worker)
# or without Bazel:
npm run test:all                    # JS via turbo + backend via pytest
```

## Tips

- Use `bazel test` for cached, hermetic runs — it skips targets whose inputs haven't changed
- Use direct `uv run pytest` or `npx vitest run` for faster iteration during TDD loops
- Backend pytest uses `-n auto` by default; add `-n0` for serial debugging
- Backend S3 is auto-mocked via moto — no setup needed

## Test Tags

| Tag | Meaning |
|---|---|
| `lint` | Lint targets; CI lint job runs `--test_tag_filters=lint`, all other jobs run `-lint`. |
| `unit` | Pure unit test (no I/O, no compose services). Informational. |
| `requires-compose` | Test needs services from `docker compose up -d` (Redis, auth-proxy, stream.io). CI skips these via `--test_tag_filters=-requires-compose`; run them locally only. |

Run the same set CI runs:
```bash
bazel test //backend/... --test_tag_filters=-lint,-requires-compose
```

Run the compose-only tests locally (compose must be up):
```bash
docker compose up -d
bazel test //backend/... --test_tag_filters=requires-compose
```

To tag a new test that needs compose, list its source path in the `compose_srcs` argument of its `pytest_tests(...)` call in `backend/BUILD.bazel`.
