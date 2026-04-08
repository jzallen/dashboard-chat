# S3 Lifecycle Cleanup: Dataset Deletion and Upload Size Enforcement

## Why

Three related data lifecycle gaps exist:

1. **Orphaned Parquet files.** `delete_project` cascade-deletes all DB records (datasets, transforms, views, reports) via SQLAlchemy, but never calls `lake.delete_parquet()`. Parquet files accumulate in MinIO/S3 indefinitely. For a platform where file upload is the entry point, orphaned storage is a real cost and compliance concern.

2. **No individual dataset deletion.** Users can delete an entire project (cascading to all datasets), but there is no `DELETE /api/projects/{project_id}/datasets/{dataset_id}` endpoint. A user who uploads the wrong file has no way to remove just that dataset without destroying the whole project.

3. **No upload size enforcement.** NFR-P4 targets 100MB. The FHIR plugin enforces `MAX_FILE_SIZE = 100_000_000` but the general upload endpoint in `uploads.py` accepts files of unlimited size. A large upload can exhaust memory or storage.

## What Changes

### S3 Cleanup on Project Deletion
- In `delete_project` use case, iterate all dataset storage paths before DB cascade delete, call `lake.delete_parquet()` for each
- Handle partial failures gracefully (log and continue — don't block project deletion if one S3 delete fails)

### Individual Dataset Deletion
- New `delete_dataset` use case following the standard `@handle_returns` / `@with_repositories` pattern
- Deletes S3 Parquet files, then the dataset record (cascade to transforms)
- Emits `DatasetRemoved` outbox event so the query engine sync processor drops the corresponding foreign table
- Authorization: verify user's org owns the dataset's project

### Dataset Delete Route
- `DELETE /api/projects/{project_id}/datasets/{dataset_id}` returning 204 on success
- Authorization via existing `authorize_dataset_access` dependency

### Upload Size Limit
- Add a size check in the upload router before processing (reject with 413 if file exceeds 100MB)
- Use a constant matching the FHIR plugin's `MAX_FILE_SIZE` for consistency

## Capabilities

### New Capabilities
- `dataset-deletion`: Use case, route, and S3 cleanup for individual dataset removal with outbox event

### Modified Capabilities
- `multi-dataset-upload`: Upload size limit enforcement (100MB)
- `external-sql-access`: Dataset removal triggers query engine view cleanup via existing outbox sync

## Impact

- `backend/app/use_cases/project/delete_project.py` — add S3 cleanup loop before DB delete
- `backend/app/use_cases/dataset/delete_dataset.py` — new use case
- `backend/app/routers/datasets.py` — new DELETE route
- `backend/app/controllers/http_controller.py` — new `delete_dataset` method
- `backend/app/routers/uploads.py` — add file size validation
- `backend/app/repositories/lake/repository.py` — verify `delete_parquet()` or equivalent exists
- `backend/app/repositories/outbox/events.py` — verify `DatasetRemoved` event type exists
- Tests: new use case tests, route tests, integration test for S3 cleanup
- No database migrations — existing tables sufficient
- No frontend changes — project/dataset list auto-refreshes via TanStack Query invalidation
