# API Endpoints

52 endpoints across 12 routers, plus 3 app-level routes. All endpoints require authentication unless noted.

## Auth (`/api/auth`)

| Method | Path | Description | Status | Auth |
|--------|------|-------------|--------|------|
| GET | `/api/auth/login` | Get login URL to redirect user to | 200 | Public |
| POST | `/api/auth/callback` | Exchange auth code for user + tokens | 200 | Public |
| POST | `/api/auth/refresh` | Exchange refresh token for new access tokens | 200 | Public |
| POST | `/api/auth/logout` | Revoke session and return logout URL | 200 | Public |
| GET | `/api/auth/me` | Get current authenticated user | 200 | Required |

## Organizations (`/api/orgs`)

| Method | Path | Description | Status | Auth |
|--------|------|-------------|--------|------|
| POST | `/api/orgs` | Create new organization | 201 | Org-less OK |
| GET | `/api/orgs/me` | Get current user's organization | 200 | Org-less OK |

## Projects (`/api/projects`)

| Method | Path | Description | Status |
|--------|------|-------------|--------|
| GET | `/api/projects` | List all projects (cursor pagination) | 200 |
| POST | `/api/projects` | Create new project | 201 |
| GET | `/api/projects/{project_id}` | Get single project | 200 |
| PATCH | `/api/projects/{project_id}` | Update project | 200 |
| DELETE | `/api/projects/{project_id}` | Delete project and all datasets | 200 |
| GET | `/api/projects/{project_id}/datasets` | List sparse datasets for project | 200 |
| GET | `/api/projects/{project_id}/export/dbt` | Export project as dbt zip archive | 200 |

## Datasets (`/api/datasets`)

| Method | Path | Description | Status |
|--------|------|-------------|--------|
| GET | `/api/datasets` | List all datasets (cursor pagination, optional project filter) | 200 |
| POST | `/api/datasets` | Create dataset from upload with partition config | 201 |
| GET | `/api/datasets/{dataset_id}` | Get dataset with optional transforms/preview | 200 |
| PATCH | `/api/datasets/{dataset_id}` | Update dataset metadata | 200 |

## Transforms (`/api/datasets/{dataset_id}/transforms`)

| Method | Path | Description | Status |
|--------|------|-------------|--------|
| POST | `/api/datasets/{dataset_id}/transforms` | Batch-create transforms | 201 |
| PATCH | `/api/datasets/{dataset_id}/transforms` | Batch-update transforms (soft-delete via status) | 200 |
| POST | `/api/datasets/{dataset_id}/transforms/preview` | Preview cleaning transform without persisting | 200 |

## Uploads (`/api/uploads`)

| Method | Path | Description | Status |
|--------|------|-------------|--------|
| POST | `/api/uploads` | Upload file and create dataset | 201/202 |
| POST | `/api/uploads/{upload_id}/process` | Process upload awaiting user input (sheet selection) | 200 |
| GET | `/api/uploads/formats` | List registered file format plugins | 200 |

## Views (`/api/projects/{project_id}/views`)

| Method | Path | Description | Status |
|--------|------|-------------|--------|
| GET | `/api/projects/{project_id}/views` | List all views for project | 200 |
| POST | `/api/projects/{project_id}/views` | Create new view | 201 |
| GET | `/api/projects/{project_id}/views/{view_id}` | Get single view | 200 |
| PATCH | `/api/projects/{project_id}/views/{view_id}` | Update view | 200 |
| DELETE | `/api/projects/{project_id}/views/{view_id}` | Delete view | 200 |

## Reports (`/api/projects/{project_id}/reports`)

| Method | Path | Description | Status |
|--------|------|-------------|--------|
| GET | `/api/projects/{project_id}/reports` | List all reports for project | 200 |
| POST | `/api/projects/{project_id}/reports` | Create new report | 201 |
| GET | `/api/projects/{project_id}/reports/{report_id}` | Get single report | 200 |
| PATCH | `/api/projects/{project_id}/reports/{report_id}` | Update report | 200 |
| DELETE | `/api/projects/{project_id}/reports/{report_id}` | Delete report | 200 |

## SQL Access (`/api/projects/{project_id}/sql-access`)

| Method | Path | Description | Status |
|--------|------|-------------|--------|
| POST | `/api/projects/{project_id}/sql-access` | Enable external SQL access | 201 |
| DELETE | `/api/projects/{project_id}/sql-access` | Disable external SQL access | 204 |
| GET | `/api/projects/{project_id}/sql-access` | Get SQL access connection details | 200 |
| POST | `/api/projects/{project_id}/sql-access/sync` | Sync SQL views with current dataset state | 200 |
| POST | `/api/projects/{project_id}/sql-access/credentials` | Regenerate credentials (60s cooldown) | 200 |

## Query Engines (`/api/query-engines`)

| Method | Path | Description | Status |
|--------|------|-------------|--------|
| GET | `/api/query-engines` | List all query engine nodes for org | 200 |
| GET | `/api/query-engines/{node_id}` | Get query engine with connection strings | 200 |
| POST | `/api/query-engines/{node_id}/test` | Test connectivity to query engine | 200 |

## Sessions (`/api/projects/{project_id}/...`)

| Method | Path | Description | Status |
|--------|------|-------------|--------|
| GET | `/api/projects/{project_id}/memory` | Get project memory (Stream channel) | 200 |
| POST | `/api/projects/{project_id}/sessions` | Create new session (Stream thread) | 201 |
| GET | `/api/projects/{project_id}/sessions` | List sessions (cursor pagination) | 200 |
| PATCH | `/api/projects/{project_id}/sessions/{session_id}` | Update session (owner-only) | 200 |
| GET | `/api/projects/{project_id}/datasets/search` | Search datasets by name within project | 200 |

## Stream Token (`/api/stream`)

| Method | Path | Description | Status |
|--------|------|-------------|--------|
| GET | `/api/stream/stream-token` | Mint Stream.io JWT for authenticated user | 200 |

## Agent Routes

| Method | Path | Description | Status |
|--------|------|-------------|--------|
| GET | `/health` | Health check | 200 |
| POST | `/chat` | Chat with SSE streaming | 200 |

## App-Level Routes

| Method | Path | Description | Status | Auth |
|--------|------|-------------|--------|------|
| GET | `/.well-known/jwks.json` | Dev-mode JWKS public key set | 200 | Public |
| GET | `/health` | Health check | 200 | Public |
| GET | `/` | Root endpoint | 200 | Public |

## Common Patterns

### Cursor-Based Pagination

List endpoints accept `page[after]` and `page[size]` query parameters:

```
GET /api/projects?page[after]=cursor_value&page[size]=25
```

Response includes pagination metadata:

```json
{
  "data": [...],
  "meta": {
    "next_cursor": "...",
    "has_more": true,
    "page_size": 25
  }
}
```

### Authorization

Project-scoped endpoints (`/api/projects/{project_id}/...`) use dependency injection to verify the authenticated user's org owns the project. Dataset-scoped endpoints similarly verify dataset ownership through the project.

### Error Responses

Errors follow JSON:API format:

```json
{
  "errors": [
    {
      "status": "404",
      "title": "Not Found",
      "detail": "Dataset not found"
    }
  ]
}
```
