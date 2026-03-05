## 1. ORM Model Defaults

- [ ] 1.1 Update `ProjectRecord` to use `uuid7()` default: In `backend/app/repositories/metadata/project_record.py`, replace `from uuid import uuid4` with `from uuid_utils import uuid7`, and change `default=lambda: str(uuid4())` to `default=lambda: str(uuid7())` on the `id` column (line 24).
- [ ] 1.2 Update `TransformRecord` to use `uuid7()` default: In `backend/app/repositories/metadata/transform_record.py`, replace `from uuid import uuid4` with `from uuid_utils import uuid7`, and change `default=lambda: str(uuid4())` to `default=lambda: str(uuid7())` on the `id` column.
- [ ] 1.3 Update `OrganizationRecord` to use `uuid7()` default: In `backend/app/repositories/metadata/organization_record.py`, replace `from uuid import uuid4` with `from uuid_utils import uuid7`, and change `default=lambda: str(uuid4())` to `default=lambda: str(uuid7())` on the `id` column.
- [ ] 1.4 Update `ExternalAccessRecord` to use `uuid7()` default: In `backend/app/repositories/metadata/external_access_record.py`, replace `from uuid import uuid4` with `from uuid_utils import uuid7`, and change `default=lambda: str(uuid4())` to `default=lambda: str(uuid7())` on the `id` column.
- [ ] 1.5 Add `uuid7()` default to `DatasetRecord`: In `backend/app/repositories/metadata/dataset_record.py`, add `from uuid_utils import uuid7` and add `default=lambda: str(uuid7())` to the `id` column definition (line 31-34). Verify that `create_dataset_from_upload.py` (which passes explicit `id=str(uuid7())`) still works since explicit values override defaults.
- [ ] 1.6 Verify `OutboxRecord` already uses `uuid7()`: Confirm `backend/app/repositories/outbox/outbox_record.py` uses `from uuid_utils import uuid7` and `default=lambda: str(uuid7())` -- no change needed.

## 2. Deterministic Test ID Pool

- [ ] 2.1 Create `backend/tests/uuidv7_fixtures.py` with named UUIDv7 constants. All values must be valid UUIDv7 (version nibble = 7, variant bits = 10). Use domain-segmented second segments for visual distinction. Include at minimum:
  - Projects: `PROJECT_1 = "019515a0-0001-7000-8000-000000000001"`, `PROJECT_2 = "019515a0-0002-7000-8000-000000000002"`, `PROJECT_EMPTY = "019515a0-0003-7000-8000-000000000003"`, `PROJECT_OTHER = "019515a0-0004-7000-8000-000000000004"`
  - Datasets: `DATASET_1 = "019515a0-1001-7000-8000-000000000011"`, `DATASET_2 = "019515a0-1002-7000-8000-000000000012"`, `DATASET_3 = "019515a0-1003-7000-8000-000000000013"`, `DATASET_OTHER = "019515a0-1004-7000-8000-000000000014"`
  - Transforms: `TRANSFORM_1 = "019515a0-2001-7000-8000-000000000021"`, `TRANSFORM_2 = "019515a0-2002-7000-8000-000000000022"`
  - Users: `USER_1 = "019515a0-3001-7000-8000-000000000031"`, `USER_2 = "019515a0-3002-7000-8000-000000000032"`
  - Organizations: `ORG_1 = "019515a0-4001-7000-8000-000000000041"`, `ORG_OTHER = "019515a0-4002-7000-8000-000000000042"`
  - External access: `EA_1 = "019515a0-5001-7000-8000-000000000051"`, `EA_DISABLED = "019515a0-5002-7000-8000-000000000052"`

## 3. Migrate Conftest Files

Each conftest migration replaces hardcoded string IDs with imports from `uuidv7_fixtures`. Storage paths that embed old IDs must also be updated to use the new constants via f-strings.

- [ ] 3.1 Migrate `backend/tests/use_cases/dataset/conftest.py`: Replace `"test-user-001"` -> `USER_1`, `"test-org-001"` -> `ORG_1`, `"project-001"` -> `PROJECT_1`, `"dataset-001"` -> `DATASET_1`, `"dataset-002"` -> `DATASET_2`, `"transform-001"` -> `TRANSFORM_1`. Update storage paths to `f"datasets/{PROJECT_1}/{DATASET_1}/"` pattern. Add `from tests.uuidv7_fixtures import ...` import.
- [ ] 3.2 Migrate `backend/tests/use_cases/project/conftest.py`: Replace `"test-user-001"` -> `USER_1`, `"test-org-001"` -> `ORG_1`, `"project-001"` -> `PROJECT_1`, `"project-002"` -> `PROJECT_2`, `"dataset-001"` -> `DATASET_1`, `"dataset-002"` -> `DATASET_2`. Update storage paths. Add fixture import.
- [ ] 3.3 Migrate `backend/tests/use_cases/upload/conftest.py`: Replace `"test-user-001"` -> `USER_1`, `"test-org-001"` -> `ORG_1`, `"project-001"` -> `PROJECT_1`, `"dataset-001"` -> `DATASET_1`. Update storage paths. Add fixture import.
- [ ] 3.4 Migrate `backend/tests/use_cases/transform/conftest.py`: Replace `"test-user-001"` -> `USER_1`, `"test-org-001"` -> `ORG_1`, `"project-001"` -> `PROJECT_1`, `"dataset-001"` -> `DATASET_1`, `"transform-001"` -> `TRANSFORM_1`, `"transform-002"` -> `TRANSFORM_2`. Update storage paths. Add fixture import.
- [ ] 3.5 Migrate `backend/tests/use_cases/sql_access/conftest.py`: Replace `"test-user-001"` -> `USER_1`, `"test-org-001"` -> `ORG_1`, `"project-001"` -> `PROJECT_1`, `"project-empty"` -> `PROJECT_EMPTY`, `"project-other"` -> `PROJECT_OTHER`, `"other-org-999"` -> `ORG_OTHER`, `"dataset-001"` -> `DATASET_1`, `"dataset-002"` -> `DATASET_2`, `"dataset-other"` -> `DATASET_OTHER`, `"ea-001"` -> `EA_1`, `"ea-disabled"` -> `EA_DISABLED`. Update storage paths. Add fixture import.
- [ ] 3.6 Migrate `backend/tests/use_cases/organization/conftest.py`: Replace `"test-user-001"` -> `USER_1`, `"test-user-002"` -> `USER_2`, `"test-org-001"` -> `ORG_1`, `"project-001"` -> `PROJECT_1`. Note: this conftest has a `TEST_USER` with `org_id=None` (no org) and `TEST_USER_WITH_ORG` with `org_id=ORG_1`. Add fixture import.
- [ ] 3.7 Migrate `backend/tests/conftest.py`: This file has no hardcoded entity IDs (only DB setup and S3 mock). Confirm no changes needed. If auth fixtures are added here in the future, they should use constants from `uuidv7_fixtures`.

## 4. Migrate Test Assertion Files

These test files reference hardcoded IDs in assertions or inline record creation. Each must be updated to import and use constants from `uuidv7_fixtures`.

- [ ] 4.1 Migrate dataset test files: `test_get_dataset.py`, `test_list_datasets.py`, `test_update_dataset.py`, `test_create_dataset_from_upload.py`. Replace all `"project-001"`, `"dataset-001"`, `"dataset-002"`, `"dataset-003"`, `"transform-001"`, `"test-org-001"` references with named constants. In `test_list_datasets.py`, the inline `DatasetRecord(id="dataset-003", ...)` should use `DATASET_3`.
- [ ] 4.2 Migrate project test files: `test_get_project.py`, `test_list_projects.py`, `test_update_project.py`, `test_delete_project.py`, `test_project_auth.py`, `test_export_dbt_project.py`. Replace all hardcoded ID references with named constants. In `test_export_dbt_project.py`, the inline fixture creates `ProjectRecord(id="proj-export-1", ...)` and `DatasetRecord(id="ds-export-1", ...)` -- these should use constants from the pool (add `PROJECT_EXPORT_1` and `DATASET_EXPORT_1` to `uuidv7_fixtures.py` if needed, or reuse existing constants).
- [ ] 4.3 Migrate transform test files: `test_create_transforms.py`, `test_update_transforms.py`, `test_preview_transform.py`. Replace all hardcoded ID references with named constants.
- [ ] 4.4 Migrate upload test files: `test_upload_file.py`. Replace all hardcoded ID references with named constants.
- [ ] 4.5 Migrate SQL access test files: `test_get_sql_access.py`, `test_enable_sql_access.py`, `test_disable_sql_access.py`, `test_sync_sql_access.py`, `test_regenerate_sql_credentials.py`. Replace all hardcoded ID references with named constants.
- [ ] 4.6 Migrate organization test files: `test_get_organization.py`. Replace all hardcoded ID references with named constants.
- [ ] 4.7 Migrate repository test files: `tests/repositories/test_external_access_repository.py`. Replace all hardcoded ID references with named constants.
- [ ] 4.8 Migrate router test files: `tests/routers/test_projects_export.py`. Replace `"proj-route-1"`, `"ds-route-1"`, `"test-user"`, `"test-org"` with constants. Note: the HTTP-level tests in this file use mocked use cases, so the seeded_db fixture IDs only matter if integration tests use them. The URL path IDs (`/api/projects/proj-1/export/dbt`) are arbitrary and don't need to match real records since the use case is mocked.

## 5. Verification

- [ ] 5.1 Run full backend test suite: `cd backend && uv run pytest` -- all tests must pass with no failures.
- [ ] 5.2 Grep for residual hardcoded IDs: Search for patterns `"project-001"`, `"dataset-001"`, `"transform-001"`, `"test-user-001"`, `"test-org-001"`, `"ea-001"` across `backend/tests/` to confirm none remain (excluding comments or documentation).
- [ ] 5.3 Verify no Alembic migration was created: Confirm no new files in `backend/migrations/versions/` beyond the existing `013_add_external_access.py`.
