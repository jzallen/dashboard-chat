# Capability: Upload Authorization Consolidation

**Status**: MODIFIED
**Domain**: upload

## Overview

Replace the inline org-access check in `upload_file.py` with `ProjectService.fetch_and_authorize_project()`, eliminating the third copy of the authorization algorithm. This converts Connascence of Algorithm into Connascence of Name — callers just need to know the service method name.

## Behaviors

### Before

`upload_file.py` manually fetches the project, then checks org_id inline:

```python
project = await metadata_repo.get_project(project_id, include_datasets=False)
user = get_auth_user()
if project and project.get("org_id") and project["org_id"] != user.org_id:
    raise AuthorizationError(...)
```

### After

`upload_file.py` delegates to `ProjectService`:

```python
project_service = ProjectService(repositories)
await project_service.fetch_and_authorize_project(project_id)
```

### Behavior Preservation

- `ProjectService.fetch_and_authorize_project` already raises `ProjectNotFound` when the project doesn't exist and `AuthorizationError` when org_id doesn't match
- The existing `_validate_references` check for project existence becomes redundant for the project (but the dataset existence check within it must be preserved)
- The authorization check still occurs before any file processing (fail-fast preserved)

## Constraints

- The upload domain now imports from `app.use_cases.project.project_service` — this is an acceptable cross-domain dependency since it's a shared service, not a use case function
- Tests must verify the same error cases: project not found, org mismatch, valid upload
