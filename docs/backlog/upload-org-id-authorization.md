# Missing org_id Authorization on Upload Processing

## Context

The `POST /api/uploads/{upload_id}/process` endpoint delegates to `HTTPController.post_dataset()` → `create_dataset_from_upload()`, which only checks `project_exists()` (`create_dataset_from_upload.py:47`) but does not verify that the authenticated user's `org_id` owns the project. An attacker who obtains or guesses a valid `upload_id` (UUID) from another organization could trigger dataset creation in that org's project.

The initial `POST /api/uploads` endpoint does call `project_service.fetch_and_authorize_project()` (`upload_file.py:72`), so the gap is specific to the second phase.

## Severity

WARNING — authorization bypass via cross-org upload processing.

## Recommendation

Add `org_id` authorization in `create_dataset_from_upload.py` after fetching the project:

```python
project = await project_service.fetch_and_authorize_project(
    file_received_event.project_id
)
```

Or add the check in the router before calling the controller.

## Files to Modify

- `backend/app/use_cases/dataset/create_dataset_from_upload.py` — add org_id check
- `backend/tests/use_cases/dataset/test_create_dataset_from_upload.py` — add test for cross-org rejection
