## 1. Ruff Configuration — Suppress FastAPI False Positives

- [ ] 1.1 Add `"app/routers/*" = ["B008"]` to `[tool.ruff.lint.per-file-ignores]` in `backend/pyproject.toml` (suppresses 27 `Depends()` false positives)

## 2. Python Auto-Fix — Mechanical Formatting and Imports

- [ ] 2.1 Run `cd backend && uv run ruff check --fix .` to auto-fix 194 issues (import sorting, unused imports, type modernization, simplifications)
- [ ] 2.2 Run `cd backend && uv run ruff format .` to format all Python files to the configured line-length/style
- [ ] 2.3 Run `cd backend && uv run pytest -n auto --dist=loadfile` to verify no tests broke from auto-fixes (especially import reordering)

## 3. TypeScript Auto-Fix — Import Sorting

- [ ] 3.1 Run `cd /workspaces/dashboard-chat && npx eslint . --fix` to auto-fix 102 issues (96 import sorts + 6 export sorts)

## 4. Python Manual Fixes — Bugs and Remaining Errors

- [ ] 4.1 Fix F821 undefined names — add missing imports:
  - `app/models/upload.py`: import `OutboxRecord` from its defining module
  - `app/repositories/external_access.py`: import `RestrictedSession`
  - `app/repositories/metadata/repository.py`: import `RestrictedSession`
  - `app/repositories/outbox/repository.py`: import `RestrictedSession`
  - `tests/integration/test_api.py`: import or define `_get_dev_token`

- [ ] 4.2 Fix B904 exception chaining — add `from err` to preserve tracebacks:
  - `app/auth/dev_provider.py`: `raise AuthenticationError(...) from err`
  - `app/auth/workos_provider.py` (2 locations): `raise ... from err`
  - `app/use_cases/transform.py`: `raise ... from err`

- [ ] 4.3 Fix F401 in `__init__.py` re-exports — convert to explicit re-export aliases:
  - `app/auth/__init__.py`: 5 imports need `as` aliases (`clear_auth_user as clear_auth_user`, `get_auth_user as get_auth_user`, `set_auth_user as set_auth_user`, `AuthenticationError as AuthenticationError`, `AuthorizationError as AuthorizationError`)
  - `app/repositories/metadata/__init__.py`: 4 imports need `as` aliases (`ProjectRecord`, `TransformRecord`, `OrganizationRecord`, `ExternalAccessRecord`)
  - `app/use_cases/project/dbt/__init__.py`: 1 import needs `as` alias (`to_snake_case`)

- [ ] 4.4 Fix E402 imports not at top of file:
  - `app/repositories/lake/__init__.py:53` — add `# noqa: E402` (intentional late import after class definition)
  - `app/repositories/metadata/__init__.py:292` — add `# noqa: E402` (intentional late import)
  - `app/repositories/outbox/__init__.py:59` — add `# noqa: E402` (intentional late import)
  - `tests/integration/test_api.py:18,20,21` — reorganize imports to top of file

- [ ] 4.5 Fix E501 lines >120 chars in 14 files:
  - `app/models/dataset.py` (4 lines), `app/controllers/http_controller.py` (1), `app/main.py` (1), `app/repositories/metadata/dataset_record.py` (1), `app/repositories/metadata/external_access_record.py` (1), `app/repositories/metadata/organization_record.py` (1), `app/repositories/metadata/project_record.py` (1), `app/repositories/metadata/transform_record.py` (1), `app/repositories/outbox/outbox_record.py` (1), `app/routers/__init__.py` (1), `app/use_cases/project/create_project.py` (1), plus 3 test files
  - Wrap long lines or extract variables to stay within 120-char limit

- [ ] 4.6 Fix remaining one-off ruff issues:
  - `UP007` (2): Replace `Optional[X]` with `X | None`
  - `SIM105` (1): Replace try/except/pass with `contextlib.suppress()`
  - `SIM116` (1): Replace if/elif chain with dictionary mapping
  - `RUF012` (1): Add `ClassVar` annotation to mutable class attribute
  - `F841` (1): Remove or use the unused variable
  - `B017` (1): Replace `pytest.raises(Exception)` with a more specific exception type

## 5. TypeScript Manual Fixes — Hook Deps, Console, Types

- [ ] 5.1 Fix 3 `react-hooks/exhaustive-deps` warnings (case-by-case review):
  - `frontend/src/lib/ui/components/TransformSettings/index.tsx:43` — add `fetchDatasetWithSql` to deps or suppress with reason
  - `frontend/src/lib/ui/hooks/useTransforms.ts:48` (2 warnings) — wrap `transforms` initialization in `useMemo()` to stabilize the reference

- [ ] 5.2 Replace 7 `console.log` calls with appropriate log levels in worker:
  - `worker/index.ts:115,120` — use `console.debug()` or `console.error()` as appropriate
  - `worker/lib/sessions/flusher.ts:68,81` — use `console.debug()`
  - `worker/lib/sessions/index.ts:34,38,42` — use `console.debug()` or `console.error()`

- [ ] 5.3 Fix 6 `@typescript-eslint/no-explicit-any` warnings — add proper types:
  - `frontend/vitest.config.ts:7`
  - `worker/index.ts:85`
  - `worker/lib/auth.test.ts:5,9` (test mocks — may suppress with inline comment instead)
  - `worker/lib/s3.ts:56`

- [ ] 5.4 Fix 2 `@typescript-eslint/no-unused-vars`:
  - `frontend/src/lib/raqb/raqbToTanstack.ts:106` — prefix `parentConjunction` with `_` → `_parentConjunction`
  - `frontend/src/lib/ui/context/ChatContext.tsx:17` — remove unused `TOKEN_KEY` or prefix with `_`

- [ ] 5.5 Fix 3 `react-refresh/only-export-components` warnings:
  - `frontend/src/lib/auth/AuthContext.tsx:251` — move non-component export to a separate file, or suppress if it's a hook/context
  - `frontend/src/lib/ui/context/ChatContext.tsx:47` — same approach
  - `frontend/src/lib/ui/providers/QueryProvider.tsx:4` — same approach

- [ ] 5.6 Suppress 16 `testing-library/no-unnecessary-act` warnings with inline comments:
  - `frontend/src/test/ui/context/ChatContext.test.tsx` (10 instances)
  - `frontend/src/test/auth/refreshTimer.test.tsx` (6 instances)
  - Add `// eslint-disable-next-line testing-library/no-unnecessary-act` above each `act()` call

## 6. Verify Clean Lint

- [ ] 6.1 Run `cd backend && uv run ruff check .` — verify exit code 0, zero errors
- [ ] 6.2 Run `cd backend && uv run ruff format --check .` — verify exit code 0, zero files need reformatting
- [ ] 6.3 Run `npx eslint .` from project root — verify exit code 0, zero problems
- [ ] 6.4 Run `cd backend && uv run pytest -n auto --dist=loadfile` — verify all backend tests still pass
- [ ] 6.5 Run `npm run test:worker` — verify all worker tests still pass
