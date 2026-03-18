# Tasks: Use Case Package Refactor

## Phase 1: Shared Foundation

- [ ] 1.1 Split `app/use_cases/exceptions.py`: Keep `DomainException` and `AuthorizationError` in the shared file. Create `dataset/exceptions.py` (`DatasetNotFound`, `InvalidExpressionConfig`, `ColumnTypeMismatch`, `PreviewNotSupported`), `project/exceptions.py` (`ProjectIdRequired`, `ProjectNotFound`, `ProjectHasNoDatasets`), `upload/exceptions.py` (`UploadNotFound`, `UploadAlreadyProcessed`, `InvalidFileType`, `EmptyFile`), `sql_access/exceptions.py` (`SqlAccessAlreadyEnabled`, `SqlAccessNotEnabled`, `CredentialCooldown`, `EnvironmentNotRunning`, `EnvironmentNotStopped`), `organization/exceptions.py` (`ExternalServiceError`). Each imports `DomainException` from the base module.
- [ ] 1.2 Add backward-compatible re-exports in `app/use_cases/exceptions.py` that import from the new domain-specific modules. This ensures existing consumers don't break during migration.
- [ ] 1.3 Update all use case imports to use domain-specific exception modules (e.g., `from app.use_cases.dataset.exceptions import DatasetNotFound`). Update test imports accordingly.
- [ ] 1.4 Once all consumers are migrated, remove the re-exports from the shared `exceptions.py`.
- [ ] 1.5 Fix CLAUDE.md: correct the `handle_returns` error format documentation. It returns `Failure(e)` (the exception object), not `f"[{func.__name__}] {str(e)}"`.

## Phase 2: Upload Authorization Fix

- [ ] 2.1 In `upload/upload_file.py`, after fetching the project record, add org_id verification: `user = get_auth_user(); if project.get("org_id") and project["org_id"] != user.org_id: raise AuthorizationError(...)`. The check must occur before any file processing.
- [ ] 2.2 Add test case in `tests/use_cases/upload/test_upload_file.py`: upload with mismatched org_id returns `Failure` containing `AuthorizationError`.
- [ ] 2.3 Update upload exception imports to use `upload/exceptions.py`.

## Phase 3: Project Domain Refactor

- [ ] 3.1 Verify `ProjectService.fetch_and_authorize_project()` signature matches the inline pattern used by the 4 use cases. Add `include_datasets` parameter if missing. Ensure it raises `ProjectNotFound` and `AuthorizationError` with the same messages.
- [ ] 3.2 Create `tests/use_cases/project/test_project_service.py` with unit tests for `ProjectService`: fetch success, project not found, org access denied, fetch with datasets.
- [ ] 3.3 Refactor `get_project.py`: replace inline fetch+auth with `ProjectService(repositories).fetch_and_authorize_project(project_id, include_datasets=True)`.
- [ ] 3.4 Refactor `update_project.py`: replace inline fetch+auth+existence-check with `ProjectService(repositories).fetch_and_authorize_project(project_id)`.
- [ ] 3.5 Refactor `delete_project.py`: replace inline fetch+auth with `ProjectService(repositories).fetch_and_authorize_project(project_id)`.
- [ ] 3.6 Refactor `export_dbt_project.py`: replace inline fetch+auth and `fetch_full_datasets` with `ProjectService` calls. Extract `_BUCKET_PLACEHOLDER = "__S3_BUCKET__"` constant.
- [ ] 3.7 Rename `project/dbt/` to `project/_dbt/`. Add `__all__` to `_dbt/__init__.py`. Update imports in `export_dbt_project.py` and all dbt test files.
- [ ] 3.8 Add `DatasetPair = tuple[str, Dataset]` type alias to `_dbt/naming.py`. Update type annotations in `sources_yml.py`, `schema_yml.py`, `bootstrap_sql.py`, and `__init__.py`.
- [ ] 3.9 Update project exception imports to use `project/exceptions.py`.
- [ ] 3.10 Run all project tests to verify no regressions.

## Phase 4: Dataset Domain Refactor

- [ ] 4.1 Create `dataset/_pipeline/__init__.py` and `dataset/_pipeline/ingestion.py`. Extract the 5 private helpers from `create_dataset_from_upload.py` as public functions in `ingestion.py`. Add `__all__` to `__init__.py`.
- [ ] 4.2 Refactor `create_dataset_from_upload.py` to import from `._pipeline` and orchestrate the pipeline steps. The use case function should be ~20 lines.
- [ ] 4.3 Unify Dataset construction: update `_pipeline/ingestion.py:create_dataset_record` to use `Dataset.from_record()` or equivalent factory instead of manual `Dataset(...)` construction.
- [ ] 4.4 Define `DEFAULT_PREVIEW_LIMIT = 10` in `dataset_service.py`. Update `_pipeline/ingestion.py:analyze_dataframe` and `DatasetService.fetch_dataset` to reference this constant.
- [ ] 4.5 Add `fetch_and_authorize_dataset()` to `DatasetService` (extracted from `transform.py:_fetch_and_authorize_dataset`).
- [ ] 4.6 Add org_id authorization check to `list_datasets.py` — verify calling user's org owns the parent project.
- [ ] 4.7 Refactor `update_dataset.py` to delegate existence checking to `DatasetService` instead of directly calling `metadata_repo.dataset_exists()`.
- [ ] 4.8 Add test for `list_datasets` cross-org rejection.
- [ ] 4.9 Add tests for `_pipeline/ingestion.py` functions (isolated unit tests for each pipeline step).
- [ ] 4.10 Update dataset exception imports to use `dataset/exceptions.py`.
- [ ] 4.11 Run all dataset tests to verify no regressions.

## Phase 5: Transform Merge into Dataset

- [ ] 5.1 Split `transform.py` into 3 files: `dataset/create_transforms.py`, `dataset/update_transforms.py`, `dataset/preview_cleaning.py`. Each file contains one use case function with the decorator stack.
- [ ] 5.2 Remove `_fetch_and_authorize_dataset` from the new files — they now call `DatasetService.fetch_and_authorize_dataset()` (added in task 4.5).
- [ ] 5.3 Update `dataset/__init__.py` to export all 7 use case functions: the original 4 + `create_transforms`, `update_transforms`, `preview_cleaning_transform`.
- [ ] 5.4 Update `app/controllers/transform.py` (or `app/routers/`) imports from `app.use_cases.transform` to `app.use_cases.dataset`.
- [ ] 5.5 Move transform test files to `tests/use_cases/dataset/` and update their imports.
- [ ] 5.6 Delete `app/use_cases/transform.py`.
- [ ] 5.7 Run all dataset and transform tests to verify no regressions.

## Phase 6: Organization Error Handling

- [ ] 6.1 Add `workos_api_url: str = "https://api.workos.com"` to `config.py` settings.
- [ ] 6.2 Create `organization/exceptions.py` with `ExternalServiceError(DomainException)` — status_code 502, type "external_service_error".
- [ ] 6.3 In `create_organization.py`, wrap `httpx` calls in `_create_workos_org` with try/except for `httpx.HTTPStatusError` and `httpx.RequestError`. Raise `ExternalServiceError` with descriptive message. Use `settings.workos_api_url` instead of hardcoded URL.
- [ ] 6.4 Add tests for WorkOS error paths using mocked httpx responses (e.g., 400, 500, network timeout).
- [ ] 6.5 Run all organization tests to verify no regressions.

## Phase 7: Verification

- [ ] 7.1 Verify every domain `__init__.py` has an explicit `__all__` exporting only use case functions.
- [ ] 7.2 Verify no domain imports use case functions from another domain (cross-domain calls go through controllers).
- [ ] 7.3 Verify all underscore-prefixed subpackages (`_pipeline/`, `_dbt/`, `_infra/`) have `__all__` in their `__init__.py`.
- [ ] 7.4 Verify the shared `exceptions.py` contains only `DomainException` base + `AuthorizationError` (no domain-specific exceptions remain).
- [ ] 7.5 Run full backend test suite: `cd backend && uv run pytest`.
- [ ] 7.6 Verify all linting passes: check for unused imports, circular dependencies.
