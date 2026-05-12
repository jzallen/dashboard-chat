# dbt Project Export Feature: Infrastructure & API Patterns

## Executive Summary
Comprehensive analysis of backend/frontend API patterns, S3/MinIO configuration, auth middleware, and response handling needed for implementing dbt project export feature.

---

## 1. Backend Router/Controller Patterns

### Router Pattern (`backend/app/routers/`)
- **Structure**: Each domain has a dedicated router file (projects.py, datasets.py, transforms.py, uploads.py)
- **Routing**: Use `APIRouter(prefix="/api/<domain>", tags=["<domain>"])` for REST resource organization
- **Dependency**: All routes depend on `use_db_context` to set the DB session context variable
- **Response Format**: Routes return `JSONResponse(content=body, status_code=status_code)` — body and status from controller

### Example Route Pattern (from `projects.py`):
```python
@router.get("/{project_id}")
async def get_project(
    project_id: str,
    include_datasets: bool = True,
    _: AsyncSession = Depends(use_db_context),  # Sets context var
):
    """Get a single project by ID with optional datasets."""
    body, status_code = await HTTPController.get_project(project_id, include_datasets)
    return JSONResponse(content=body, status_code=status_code)
```

### Controller Pattern (`backend/app/controllers/http_controller.py`)
- **Design**: Static class with async methods returning `tuple[dict, int]` (body, status_code)
- **Result Handling**: Uses `returns.result.Success | Failure` pattern
  - Success: Serialize data via `_serialize()` and wrap with `wrap_success()` → `{"success": True, "data": ...}`
  - Failure: Convert exception to error response via `_error_response(error)` → RFC 9457 format
- **Error Format**: 
  ```python
  {
      "type": error._type,           # e.g. "PROJECT_NOT_FOUND"
      "title": error._title,         # e.g. "Project Not Found"
      "status": error._status_code,  # e.g. 404
      "detail": str(error)           # Full error message
  }
  ```

### Key Example Controller Method (from `http_controller.py`):
```python
@staticmethod
async def get_project(project_id: str, include_datasets: bool = True) -> tuple[dict, int]:
    result = await project_use_cases.get_project(project_id, include_datasets=include_datasets)
    match result:
        case Success(data):
            return wrap_success(_serialize(data)), 200
        case Failure(error):
            return _error_response(error)
```

---

## 2. S3/MinIO Configuration

### Environment Variables (from `docker-compose.yml`)
```yaml
# Backend service
MINIO_ENDPOINT: minio:9000          # hostname:port (no protocol prefix)
MINIO_ACCESS_KEY: minioadmin
MINIO_SECRET_KEY: minioadmin

# Worker service
S3_ENDPOINT: http://minio:9000      # Full URL with protocol
S3_ACCESS_KEY: minioadmin
S3_SECRET_KEY: minioadmin
S3_BUCKET_LOGS: dashboard-chat.logs
S3_REGION: us-east-1
```

### Settings Configuration (from `backend/app/config.py`)
```python
storage_type: str = "minio"  # or "s3" for production
minio_endpoint: str = "localhost:9000"
minio_access_key: str = "minioadmin"
minio_secret_key: str = "minioadmin"
minio_secure: bool = False
storage_bucket: str = "dashboard-chat.datalake"

# S3/MinIO client settings
s3_max_retries: int = 1
s3_connect_timeout: int = 5
s3_read_timeout: int = 10
```

### S3 Client Initialization (from `MinIOLakeRepository.__init__`)
```python
s3_client = boto3.client(
    's3',
    endpoint_url=f"http://{settings.minio_endpoint}",  # MinIO endpoint
    aws_access_key_id=settings.minio_access_key,
    aws_secret_access_key=settings.minio_secret_key,
    config=Config(
        signature_version='s3v4',
        retries={'max_attempts': settings.s3_max_retries, 'mode': 'standard'},
        connect_timeout=settings.s3_connect_timeout,
        read_timeout=settings.s3_read_timeout,
    ),
)
```

### Storage Bucket and Path Conventions
- **Bucket**: `dashboard-chat.datalake` (configured in Settings)
- **Path Patterns**:
  - Raw uploads: `uploads/{project_id}/{upload_id}.csv`
  - Partitioned datasets: `datasets/{project_id}/{dataset_id}/` (trailing slash)
  - Partition structure: `datasets/{project_id}/{dataset_id}/{field}={value}/part-0.parquet`
- **Dataset Storage Path** (`models.dataset.Dataset.storage_path`):
  ```python
  @property
  def storage_path(self) -> str:
      return f"datasets/{self.project_id}/{self.id}/"
  ```

### S3 Operations via `BaseLakeRepository`
- **Write**: `put_object(Bucket, Key, Body, ContentType)`
- **Read**: `get_object(Bucket, Key)['Body'].read()`
- **Delete**: `delete_object(Bucket, Key)`
- **Read Parquet**: Via Ibis + DuckDB with S3 endpoint configured

---

## 3. Auth Middleware

### Middleware Flow (from `backend/app/auth/middleware.py`)
```python
# AuthMiddleware.dispatch():
1. Check if path in PUBLIC_PATHS → skip auth
2. Extract Bearer token from Authorization header
3. Verify token via auth provider (dev or WorkOS)
4. Enrich org_id from local DB if needed (WorkOS)
5. Set auth context via set_auth_user(user)
6. Check org_less_paths (only /api/orgs paths allowed without org)
7. Return 403 if org_id is None and path requires org
```

### Public & Org-Less Paths
```python
PUBLIC_PATHS = {
    "/health", "/", "/docs", "/openapi.json", "/redoc",
    "/api/auth/login", "/api/auth/callback", "/api/auth/logout", "/api/auth/refresh",
}

ORG_LESS_PATHS = {"/api/orgs", "/api/orgs/me"}
```

### Auth Context (from `backend/app/auth/context.py`)
```python
_auth_user: ContextVar[AuthUser | None] = ContextVar("auth_user", default=None)

def get_auth_user() -> AuthUser:
    user = _auth_user.get()
    if user is None:
        raise RuntimeError("No auth user in context. Auth middleware must run first.")
    return user

def set_auth_user(user: AuthUser) -> None:
    _auth_user.set(user)
```

### AuthUser Type (from `backend/app/auth/types.py`)
```python
@dataclass(frozen=True)
class AuthUser:
    id: str
    email: str
    org_id: str | None = None
    name: str | None = None
    org_name: str | None = None
```

### Org_ID Verification in Use Cases
All use cases that access org-scoped resources (projects, datasets) verify org_id:

**Example from `get_project` use case**:
```python
user = get_auth_user()
if project.get("org_id") and project["org_id"] != user.org_id:
    raise AuthorizationError(f"Access denied to project {project_id}")
```

**Example from `DatasetService.fetch_dataset()`**:
```python
user = get_auth_user()
if dataset_record.project and hasattr(dataset_record.project, 'org_id'):
    if dataset_record.project.org_id and dataset_record.project.org_id != user.org_id:
        raise AuthorizationError(f"Access denied to dataset {dataset_id}")
```

---

## 4. Frontend API Client

### Base Client Pattern (from `reverse-proxy/src/lib/api/client.ts`)
- **API URL**: From `import.meta.env.VITE_API_URL` (defaults to "" = same origin)
- **Auth Headers**: `getAuthHeaders()` returns `{ Authorization: "Bearer <token>" }`
- **Error Handling**: 
  - 401 → attempt token refresh via `ensureFreshToken()`, replay request once
  - If refresh fails → `hardLogout()` and throw
  - Non-JSON responses fallback to status code message
  - RFC 9457 errors: Shows user-friendly `title` or `type`, console logs full `detail`

### Generic Response Unwrapping
```typescript
async function handleResponse<T>(response: Response, url: string, init: RequestInit): Promise<T> {
  // ... auth retry logic ...
  const json = await res.json();
  
  // Unwrap {data: ...} responses from backend
  if (json && typeof json === 'object' && 'data' in json) {
    return json.data as T;
  }
  return json;
}
```

### Available HTTP Methods
1. **GET**: `get<T>(endpoint): Promise<T>`
2. **POST**: `post<T>(endpoint, body): Promise<T>`
3. **PATCH**: `patch<T>(endpoint, body): Promise<T>`
4. **File Upload**: `uploadFile<T>(endpoint, file, additionalFields): Promise<T>`
   - Uses FormData with multipart/form-data
   - Additional fields passed as form fields

### Token Refresh Logic (from `fetchUtils.ts`)
- Coalesced refresh: Multiple concurrent callers share single in-flight refresh request
- Stored tokens: `TOKEN_KEY`, `REFRESH_TOKEN_KEY`, `EXPIRES_AT_KEY` in localStorage
- Refresh endpoint: `POST /api/auth/refresh` with `refresh_token` in body
- Response structure: `{ access_token, refresh_token, expires_in }`

---

## 5. File Download Pattern (for dbt export)

### No Existing File Download Endpoints
- **Current state**: No `StreamingResponse` or `FileResponse` patterns found in codebase
- **Closest pattern**: File upload via multipart form at `POST /api/uploads`
- **Implication**: File download will need new pattern

### Recommended FastAPI File Download Pattern
```python
from fastapi.responses import StreamingResponse, FileResponse
from io import BytesIO

# Option 1: StreamingResponse for large files/streams
@router.get("/projects/{project_id}/export")
async def export_project(project_id: str, _: AsyncSession = Depends(use_db_context)):
    zip_buffer = BytesIO()
    # ... generate zip ...
    return StreamingResponse(
        iter([zip_buffer.getvalue()]),
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={project_id}_dbt.zip"}
    )

# Option 2: FileResponse for files on disk
return FileResponse(
    path=file_path,
    media_type="application/zip",
    headers={"Content-Disposition": f"attachment; filename={filename}"}
)
```

### Frontend File Download Pattern (to add)
```typescript
export async function downloadDbtExport(projectId: string): Promise<void> {
  const url = `${API_BASE_URL}/api/projects/${projectId}/export`;
  const response = await fetch(url, {
    headers: getAuthHeaders(),
  });
  
  if (!response.ok) throw new ApiError(response.status, "Download failed");
  
  const blob = await response.blob();
  const filename = response.headers.get("content-disposition")?.split("filename=")[1] || "export.zip";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
```

---

## 6. Docker Compose Services & Environment

### Service Stack
| Service | Port | Purpose |
|---------|------|---------|
| Frontend | 5173 | React dev server (Vite) |
| Backend | 8000 | FastAPI server |
| Worker | 8787 | Hono chat API |
| MinIO | 9000 | S3-compatible object storage |
| MinIO Console | 9001 | Web UI for MinIO |
| Redis | 6379 | Session write buffer |
| PostgreSQL | 5432 | (optional, profile="full") |

### Backend Container Environment
```yaml
DATABASE_URL: sqlite+aiosqlite:///./data/app.db  # (or PostgreSQL for full profile)
CORS_ORIGINS: http://localhost:5173,http://localhost:3000,https://*.gitpod.io
DEBUG: true
MINIO_ENDPOINT: minio:9000
AUTH_MODE: dev  # or "workos"
AUTO_PROVISION_ORG: true
WORKOS_API_KEY: (from env)
WORKOS_CLIENT_ID: (from env)
WORKOS_REDIRECT_URI: http://localhost:5173/auth/callback
```

### MinIO Access Credentials
- Default user: `minioadmin`
- Default password: `minioadmin`
- Health check: `curl -f http://localhost:9000/minio/health/live`

---

## 7. Use Case Architecture

### Decorator Stack Pattern
```python
@with_repositories     # Outer: injects RepositoryContainer, commits on success
@handle_returns        # Inner: wraps result in Success/Failure
async def some_use_case(...) -> Result[Model, str]:
    # business logic
```

### With_Repositories Decorator
- Pops `repositories` kwarg from function call
- Accepts: RepositoryContainer instance, dict of overrides, or None (creates default)
- On success: Auto-commits the database session
- On failure: Auto-rollbacks and re-raises exception
- **Key**: Ensures transactional consistency across use cases

### Handle_Returns Decorator
- Wraps exceptions as `Failure(error)`
- Converts domain exceptions to standardized `[func_name] error message` format
- Returns `Success(data)` for happy path
- Allows `match result: case Success(...) / case Failure(...)`

### Repository Container
```python
class RepositoryContainer:
    def __init__(self, db: RestrictedSession, overrides: dict | None = None):
        self._registry = {
            'metadata_repository': partial(MetadataRepository, db),
            'lake_repository': MinIOLakeRepository,
            'outbox_repository': partial(OutboxRepository, db),
            **(overrides or {}),
        }
```

---

## 8. Project & Dataset Domain Models

### Project Model (from `backend/app/models/project.py`)
```python
@dataclass(frozen=True)
class Project:
    id: str
    name: str
    description: str | None = None
    datasets: list[Dataset] = field(default_factory=list)
    created_at: datetime | None = None
    updated_at: datetime | None = None
    
    def serialize(self) -> dict[str, Any]:
        return {
            'id', 'name', 'description',
            'datasets': [d.serialize() for d in self.datasets],
            'created_at': ..., 'updated_at': ...
        }
```

### Dataset Model (from `backend/app/models/dataset.py`)
```python
@dataclass(frozen=True)
class Dataset:
    id: str
    project_id: str | None = None
    name: str = "New Dataset"
    description: str | None = None
    schema_config: dict[str, Any]  # Column defs for query builder
    partition_fields: list[str]    # Hive partition fields
    transforms: list[Transform]    # Cleaning, filter, alias transforms
    preview_rows: list[dict]       # Sample data (on-demand)
    column_profiles: dict | None   # Stats (min/max, samples, etc.)
    
    @property
    def storage_path(self) -> str:
        return f"datasets/{self.project_id}/{self.id}/"
```

### Transform Model (from `backend/app/models/transform.py`)
Contains: id, name, description, condition_json (RAQB), condition_sql, status (enabled/disabled/deleted), transform_type, target_column, expression_config, expression_sql

---

## 9. Existing Streaming / Binary Response Patterns

### Current State
- **No existing StreamingResponse or FileResponse** patterns found in backend/app code
- Uploads handled via multipart form: `POST /api/uploads` → UploadFile processed → dataset created
- All other responses are JSON via JSONResponse

### Recommended Approach for dbt Export
1. New router endpoint: `GET /api/projects/{project_id}/export`
2. Auth via middleware (org_id verification in use case)
3. Controller method: Generates dbt project structure, creates zip in memory
4. Router: Returns `StreamingResponse` with zip bytes, attachment headers
5. Frontend: Fetch with auth headers, create blob download link

---

## 10. Key Implementation Checklist for dbt Export

### Backend
- [ ] Create `backend/app/use_cases/project/export_dbt_project.py` use case
  - Fetch project with datasets and transforms (org_id verified by middleware)
  - Call DatasetService to fetch each dataset (auto-org verification)
  - Generate dbt_project.yml, profiles.yml, schema.yml, sources.yml, model SQL files
  - Package as ZIP file
- [ ] Add controller method: `HTTPController.export_project_as_dbt(project_id) -> tuple[dict, int]`
- [ ] Add router endpoint: `GET /api/projects/{project_id}/export` returning StreamingResponse
- [ ] Handle errors: ProjectNotFound (404), AuthorizationError (403)

### Frontend
- [ ] Add export function to `reverse-proxy/src/lib/api/projects.ts`
- [ ] Use fetch with auth headers, handle blob download
- [ ] Add UI button to export dbt project

### Configuration
- [ ] S3 client already available via MinIOLakeRepository
- [ ] Auth context already set by middleware
- [ ] Use existing project/dataset models

---

## 11. Error Handling Standards

### Domain Exceptions (inherit from DomainException)
```python
class DomainException(Exception):
    _status_code: int  # HTTP status
    _type: str         # Machine-readable type
    _title: str        # User-friendly title
    
# Examples:
class ProjectNotFound(DomainException):
    _status_code = 404
    _type = "PROJECT_NOT_FOUND"
    _title = "Project Not Found"

class AuthorizationError(DomainException):
    _status_code = 403
    _type = "ACCESS_DENIED"
    _title = "Access Denied"
```

### Error Response Format (RFC 9457)
```python
{
    "type": "PROJECT_NOT_FOUND",
    "title": "Project Not Found",
    "status": 404,
    "detail": "[get_project] Project with ID xyz not found"
}
```

---

## 12. Reference Files for dbt Export Feature

### Key Files to Reference
- **Routers**: `/workspaces/dashboard-chat/backend/app/routers/{projects,datasets}.py`
- **Controllers**: `/workspaces/dashboard-chat/backend/app/controllers/http_controller.py`
- **Use Cases**: `/workspaces/dashboard-chat/backend/app/use_cases/project/get_project.py`
- **DatasetService**: `/workspaces/dashboard-chat/backend/app/use_cases/dataset/dataset_service.py`
- **Auth**: `/workspaces/dashboard-chat/backend/app/auth/middleware.py`
- **Models**: `/workspaces/dashboard-chat/backend/app/models/{project,dataset}.py`
- **S3 Client**: `/workspaces/dashboard-chat/backend/app/repositories/lake/repository.py`
- **Frontend Client**: `/workspaces/dashboard-chat/reverse-proxy/src/lib/api/client.ts`
- **Feature Spec**: `/workspaces/dashboard-chat/features/dbt-project-export.feature`

### Test Patterns
- Use `set_session(db)` and `set_auth_user(user)` in tests before calling use cases
- Mock repository: `await use_case(..., repositories={'metadata_repository': MockRepo})`
- Error messages must match: `f"[{func.__name__}] {str(e)}"`
