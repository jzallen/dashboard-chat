# Capability: Upload Authorization Fix

**Status**: MODIFIED
**Domain**: upload

## Overview

Add missing org_id authorization check to the upload use case, preventing cross-org file uploads.

## Behaviors

### Authorization Check

- After validating that the target project exists, `upload_file` verifies that `project.org_id == user.org_id`
- If the org_id does not match, raises `AuthorizationError(f"Access denied to project {project_id}")`
- The check follows the same pattern used in `DatasetService._verify_org_access` and `ProjectService.fetch_and_authorize_project`

### Exception Co-location

- `UploadNotFound`, `UploadAlreadyProcessed`, `InvalidFileType`, and `EmptyFile` move from `app/use_cases/exceptions.py` to `upload/exceptions.py`

## Constraints

- The auth check must occur before any file processing (fail fast)
- Tests must cover the cross-org rejection case
