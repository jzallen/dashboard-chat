# Tasks: Use Case Connascence Reduction

## Phase 1: Status Literal Fix

- [ ] 1.1 In `enable_sql_access.py:_store_access_record`, replace `environment_status="running"` with `environment_status=Status.RUNNING`. Add import `from app.use_cases.sql_access._status import EnvironmentStatusValue as Status` if not already present in the function's scope.
- [ ] 1.2 Run `cd backend && uv run pytest tests/use_cases/sql_access/test_enable_sql_access.py` to verify no regressions.

## Phase 2: Upload Auth Consolidation

- [ ] 2.1 In `upload_file.py`, add import `from app.use_cases.project.project_service import ProjectService`.
- [ ] 2.2 Replace the inline auth block (lines 70-73: `metadata_repo.get_project` + manual org check) with `project_service = ProjectService(repositories)` and `await project_service.fetch_and_authorize_project(project_id)`.
- [ ] 2.3 Simplify `_validate_references` to only check dataset existence (remove the `project_exists` check since `ProjectService` handles it). Rename to `_validate_dataset_exists` for clarity, or inline the single check if the function becomes trivial.
- [ ] 2.4 Update `tests/use_cases/upload/test_upload_file.py`: verify that upload with non-existent project returns `Failure` containing `ProjectNotFound` (behavior preserved from `ProjectService`).
- [ ] 2.5 Verify that the existing cross-org rejection test still passes (the `AuthorizationError` is now raised by `ProjectService` instead of inline code).
- [ ] 2.6 Run `cd backend && uv run pytest tests/use_cases/upload/` to verify no regressions.

## Phase 3: Typed RepositoryContainer

- [ ] 3.1 In `app/repositories/__init__.py`, add four typed properties to `RepositoryContainer`:
  - `metadata` → `MetadataRepository`
  - `lake` → `LakeRepository`
  - `outbox` → `OutboxRepository`
  - `external_access` → `ExternalAccessRepository`
  Each delegates to `self["registry_key"]` with appropriate return type.
- [ ] 3.2 Migrate dataset domain use cases (`get_dataset.py`, `list_datasets.py`, `create_dataset_from_upload.py`, `update_dataset.py`, `create_transforms.py`, `update_transforms.py`, `preview_cleaning.py`) from `repositories["key"]` to `repositories.property`.
- [ ] 3.3 Migrate dataset service (`dataset_service.py`) from `repositories["key"]` to `repositories.property`.
- [ ] 3.4 Migrate project domain use cases (`create_project.py`, `list_projects.py`, `update_project.py`, `delete_project.py`, `export_dbt_project.py`) from `repositories["key"]` to `repositories.property`.
- [ ] 3.5 Migrate project service (`project_service.py`) from `repositories["key"]` to `repositories.property`.
- [ ] 3.6 Migrate sql_access domain use cases (`enable_sql_access.py`, `disable_sql_access.py`, `get_sql_access.py`, `get_environment_status.py`, `start_environment.py`, `stop_environment.py`, `restart_environment.py`, `sync_sql_access.py`, `regenerate_sql_credentials.py`, `reconcile_sql_access.py`) from `repositories["key"]` to `repositories.property`.
- [ ] 3.7 Migrate upload domain (`upload_file.py`) from `repositories["key"]` to `repositories.property`.
- [ ] 3.8 Migrate organization domain (`get_organization.py`, `create_organization.py`) from `repositories["key"]` to `repositories.property`.
- [ ] 3.9 Remove now-unnecessary local type annotations (e.g., `metadata_repo: MetadataRepository = repositories["metadata_repository"]` becomes `metadata_repo = repositories.metadata`).
- [ ] 3.10 Run `cd backend && uv run pytest` to verify no regressions across all domains.

## Phase 4: Typed Access Record

- [ ] 4.1 In `app/repositories/external_access.py`, define `AccessRecordView` as a frozen dataclass with all fields currently in `_to_dict()`. Define `AccessRecordWithHash(AccessRecordView)` adding `pg_password_hash: str`.
- [ ] 4.2 Refactor `_to_dict()` to construct and return an `AccessRecordView` instance. Refactor `_to_dict_with_hash()` to construct and return an `AccessRecordWithHash` instance.
- [ ] 4.3 Update return type annotations on all `ExternalAccessRepository` public methods: `dict[str, Any] | None` → `AccessRecordView | None` (or `AccessRecordWithHash | None` for `get_by_project_id_with_hash`). Update `list_enabled` to return `list[AccessRecordView]`.
- [ ] 4.4 Migrate `sql_access/enable_sql_access.py`: replace all `access_record["key"]` with `access_record.key`. Update `access_record.get("key", default)` patterns to use attribute access with appropriate defaults.
- [ ] 4.5 Migrate `sql_access/disable_sql_access.py`, `sql_access/stop_environment.py`, `sql_access/get_sql_access.py`, `sql_access/get_environment_status.py`: replace dict access with attribute access.
- [ ] 4.6 Migrate `sql_access/start_environment.py`, `sql_access/restart_environment.py`: replace dict access with attribute access.
- [ ] 4.7 Migrate `sql_access/sync_sql_access.py`, `sql_access/regenerate_sql_credentials.py`: replace dict access with attribute access.
- [ ] 4.8 Migrate `sql_access/reconcile_sql_access.py`: replace dict access with attribute access. Note: this file passes `record` to helper functions — update helper function signatures to accept `AccessRecordView`.
- [ ] 4.9 Migrate `sql_access/sql_access_service.py`: replace `access_record["key"]` with attribute access.
- [ ] 4.10 Update test fixtures and mock data in `tests/use_cases/sql_access/` to construct `AccessRecordView` / `AccessRecordWithHash` instances instead of dict literals.
- [ ] 4.11 Export `AccessRecordView` and `AccessRecordWithHash` from `app/repositories/__init__.py` so they can be imported by use cases and tests.
- [ ] 4.12 Run `cd backend && uv run pytest tests/use_cases/sql_access/` to verify no regressions.

## Phase 5: Verification

- [ ] 5.1 Run full backend test suite: `cd backend && uv run pytest`.
- [ ] 5.2 Verify linting passes (no unused imports, no type errors from the migration).
- [ ] 5.3 Verify no remaining `repositories["` string-index patterns in use case files (grep check).
- [ ] 5.4 Verify no remaining `access_record["` dict-index patterns in sql_access use case files (grep check).
