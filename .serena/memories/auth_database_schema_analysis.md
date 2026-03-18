# Auth Database Schema & Data Model Analysis

## 1. Auth-Related SQLAlchemy Models

### Core Auth Types (backend/app/auth/types.py)
```python
@dataclass(frozen=True)
class AuthUser:
    id: str                      # User ID (from WorkOS/dev provider)
    email: str                   # User email
    org_id: str | None = None    # Organization ID (can be enriched from local DB)
    name: str | None = None      # User full name
    org_name: str | None = None  # Organization name
```
- **Not persisted**: AuthUser is an in-memory data structure passed via context var
- **Storage**: Only stored in context var during request handling

### ORM Models with Auth Columns

#### 1. ProjectRecord (backend/app/repositories/metadata/project_record.py)
```python
class ProjectRecord(Base):
    __tablename__ = "projects"
    
    id: Mapped[str]              # String(36), PK (UUID)
    name: Mapped[str]            # String(255), NOT NULL
    description: Mapped[str|None] # Text, nullable
    org_id: Mapped[str|None]     # String(36), nullable, indexed
    created_by: Mapped[str|None] # String(36), nullable
    created_at: Mapped[datetime]  # DateTime, NOT NULL
    updated_at: Mapped[datetime]  # DateTime, NOT NULL
```
- **Auth columns**: `org_id`, `created_by`
- **Index**: `ix_projects_org_id` on `org_id` for multi-tenant filtering
- **Migration**: Added in 010_add_auth_columns.py

#### 2. OrganizationRecord (backend/app/repositories/metadata/organization_record.py)
```python
class OrganizationRecord(Base):
    __tablename__ = "organizations"
    
    id: Mapped[str]              # String(36), PK (UUID)
    name: Mapped[str]            # String(255), NOT NULL
    created_at: Mapped[datetime]  # DateTime, NOT NULL
    updated_at: Mapped[datetime]  # DateTime, NOT NULL
```
- **Auth-related**: Multi-tenant organization container
- **No user/token columns**: Organizations are simple containers
- **Migration**: Created in 011_add_organizations_table.py

#### 3. DatasetRecord (backend/app/repositories/metadata/dataset_record.py)
```python
class DatasetRecord(Base):
    __tablename__ = "datasets"
    
    id: Mapped[str]              # String(36), PK (UUID)
    storage_path: Mapped[str]    # String(255), NOT NULL, unique, indexed
    project_id: Mapped[str]      # String(36), FK to projects.id, NOT NULL
    name: Mapped[str]            # String(255), NOT NULL
    description: Mapped[str|None] # Text, nullable
    schema_config: Mapped[dict]  # JSON
    partition_fields: Mapped[list] # JSON
    column_profiles: Mapped[dict|None] # JSON
    created_at: Mapped[datetime]  # DateTime, NOT NULL
    updated_at: Mapped[datetime]  # DateTime, NOT NULL
    # Relationships
    project: Mapped[ProjectRecord] # back_populates="datasets"
    transforms: Mapped[list[TransformRecord]] # back_populates="dataset"
```
- **NO auth columns**: Auth enforcement is via parent project.org_id
- **Scoping mechanism**: Access controlled through ProjectRecord.org_id

#### 4. TransformRecord (backend/app/repositories/metadata/transform_record.py)
```python
class TransformRecord(Base):
    __tablename__ = "transforms"
    
    id: Mapped[str]              # String(36), PK (UUID)
    dataset_id: Mapped[str]      # String(36), FK to datasets.id, NOT NULL
    name: Mapped[str]            # String(255), NOT NULL
    description: Mapped[str|None] # Text, nullable
    condition_json: Mapped[dict] # JSON
    condition_sql: Mapped[str|None] # Text
    version: Mapped[int]         # Integer, default=1
    status: Mapped[str]          # String(20), default='enabled'
    transform_type: Mapped[str]  # String(20), default='filter' (added in 012)
    target_column: Mapped[str|None] # String(255), nullable (added in 012)
    expression_sql: Mapped[str|None] # Text, nullable (added in 012)
    expression_config: Mapped[dict|None] # JSON, nullable (added in 012)
    nl_prompt: Mapped[str|None] # Text
    created_at: Mapped[datetime]  # DateTime, NOT NULL
    updated_at: Mapped[datetime]  # DateTime, NOT NULL
    # Relationships
    dataset: Mapped[DatasetRecord] # back_populates="transforms"
```
- **NO auth columns**: Auth inherited from dataset → project

---

## 2. Migration History (Auth-Related)

### Full Migration Timeline
```
001_initial_schema.py          (2024-01-22) - projects, datasets, transforms
002_rename_to_transforms.py    (2024-01-23) - filter_pipelines → transforms
003_parquet_storage.py         (2024-01-28) - add storage path
004_uuid_ids_with_storage_path.py (2024-01-29) - UUID conversion
005_add_upload_events.py       (2024-02-02) - upload tracking
006_add_outbox_messages.py     (2024-02-02) - event outbox pattern
007_add_column_profiles.py     (2024-02-11) - column statistics
008_add_chat_sessions.py       (2024-02-11) - [DROPPED] chat_sessions + chat_turns tables
009_drop_chat_sessions.py      (2024-02-12) - Dropped 008 (sessions moved to worker/Redis)
010_add_auth_columns.py        (2024-02-12) - org_id + created_by to projects ← MAIN AUTH MIGRATION
011_add_organizations_table.py (2024-02-13) - organizations table
012_add_cleaning_transform_columns.py (2024-02-15) - transform_type, target_column, expression_sql, expression_config
```

### Migration 010: Add Auth Columns (CRITICAL)
```python
# Adds to projects table:
- org_id: String(36), nullable, indexed (ix_projects_org_id)
- created_by: String(36), nullable
```
**Current schema includes these columns on projects.**

### Migration 011: Add Organizations Table (CURRENT)
```python
CREATE TABLE organizations (
    id: String(36) PK,
    name: String(255) NOT NULL,
    created_at: DateTime NOT NULL,
    updated_at: DateTime NOT NULL
)
```
**Organizations exist in DB but not returned to auth provider yet.**

---

## 3. Session/Token Storage Mechanisms

### CRITICAL: NO SESSION/TOKEN DATABASE STORAGE

#### What Was Tried (Migration 008 - DROPPED)
- `chat_sessions` table: id, dataset_id, created_at, updated_at
- `chat_turns` table: id, session_id, sequence, user_message, system_prompt, tool_definitions, assistant_content, tool_calls, tool_results, table_schema, created_at
- **Rationale for removal**: "Sessions are now managed by the chat worker with Redis + S3"
- **Migration 009 dropped this entirely** — moved to worker layer

#### Current Token Management (NO TTL DATABASE)
1. **WorkOS JWT tokens**: Verified on every request via JWKS
   - JWT validation includes expiry check via `jwt.ExpiredSignatureError`
   - No token storage needed — JWT is self-contained
   - Backend only validates, never stores

2. **Dev mode tokens**: Static hardcoded token
   - `DEV_TOKEN = "dev-token-static"` (backend/app/auth/dev_provider.py)
   - No expiration in dev mode
   - Only for local development

3. **Worker session storage** (NOT in backend)
   - Handled by worker service via Redis + S3 (per migration 009 comment)
   - Backend has no Redis client or session storage

#### Backend Auth Flow (No Session Persistence)
```
Client sends: Authorization: Bearer <token>
↓
AuthMiddleware.dispatch() extracts token
↓
provider.verify_token(token) 
  - WorkOS: JWKS validation + JWT decode (checks exp claim)
  - Dev: Simple string comparison
↓
AuthUser object created in memory
↓
set_auth_user(auth_user) stores in ContextVar
↓
Request handled with auth_user in context
↓
Context cleared after response
```

---

## 4. Repository Auth Scoping Patterns

### MetadataRepository (backend/app/repositories/metadata/repository.py)

#### list_projects() - Org-aware scoping
```python
async def list_projects(self, org_id: str | None = None) -> list[dict]:
    query = select(ProjectRecord)
    if org_id is not None:
        query = query.where(ProjectRecord.org_id == org_id)
    query = query.order_by(ProjectRecord.created_at.desc())
    # Returns only projects matching org_id
```

#### get_project() - NO org verification
```python
async def get_project(self, project_id: str, include_datasets=True) -> dict | None:
    query = select(ProjectRecord).where(ProjectRecord.id == project_id)
    # NOTE: No org_id filter! Auth check must happen in controller
```
**PATTERN**: Repository doesn't enforce auth, controller/use case must:
- Check `user.org_id` matches `project.org_id` before operations
- See: DatasetService.fetch_dataset() in use cases

#### get_dataset() - Inherited org scoping
```python
async def get_dataset(self, dataset_id: str, include_transforms=True) -> dict | None:
    dataset = await self.get_dataset_record(dataset_id, include_transforms)
    # NO org_id check in repository
    # Auth check happens via parent project
```

#### Dataset Scoping (Upstream in Project)
```python
# DatasetRecord has project_id FK
# Project has org_id
# Auth flow: dataset → project.org_id → verify user.org_id
```

### No Repository-Level Auth Enforcement
- Repositories are "auth-unaware" — they just query data
- Authorization logic lives in **use cases** and **controllers**
- Controllers extract `user = get_auth_user()` and verify `user.org_id`

---

## 5. Config/Settings (backend/app/config.py)

### Auth-Related Settings
```python
# Auth
auth_mode: str = "dev"  # "dev" or "workos"
auto_provision_org: bool = False  # auto-create org + project on login
workos_api_key: str = ""
workos_client_id: str = ""
workos_redirect_uri: str = "http://localhost:5173/auth/callback"
```

### Storage Config (No Redis Settings)
```python
storage_type: str = "minio"  # or "s3"
minio_endpoint: str = "localhost:9000"
minio_access_key: str = "minioadmin"
minio_secret_key: str = "minioadmin"
s3_region: str = "us-east-1"
s3_max_retries: int = 1
s3_connect_timeout: int = 5
s3_read_timeout: int = 10
```

### NO Token/Session TTL Settings
- No `token_ttl`, `session_ttl`, or similar settings
- WorkOS handles JWT expiry via JWT spec (exp claim)
- Worker handles session lifetime (outside backend scope)

---

## 6. Auth-Related Routes (backend/app/routers/auth.py)

### Public Endpoints (No auth required)
- `POST /api/auth/login` — Get WorkOS login URL
- `POST /api/auth/callback` — Exchange code for user + token
- `POST /api/auth/logout` — Get logout URL

### Protected Endpoints (Bearer token required)
- `GET /api/auth/me` — Get current authenticated user (org-aware)

### Response Format
```json
{
  "user": {
    "id": "user-id",
    "email": "user@example.com",
    "org_id": "org-id",
    "name": "User Name"
  },
  "token": "jwt-token-string"
}
```

---

## 7. Auth Middleware Behavior (backend/app/auth/middleware.py)

### Request Flow
1. Skip public paths: `/health`, `/`, `/docs`, `/auth/*`
2. Extract `Authorization: Bearer <token>` header
3. Call `provider.verify_token(token)` → returns `AuthUser`
4. Call `enrich_org_id(user)` — lookup org_id from projects table if missing
5. Call `set_auth_user(user)` — store in context var
6. Block if org_id is None AND path not in ORG_LESS_PATHS:
   - Allowed for org-less users: `/api/orgs`, `/api/orgs/me`
   - Returns 403 "Organization required" for other paths

### Context Var Mechanism
```python
_auth_user: ContextVar[AuthUser | None] = ContextVar("auth_user", default=None)

def get_auth_user() -> AuthUser:  # For use in use cases/controllers
def set_auth_user(user: AuthUser) -> None:  # Set by middleware
def clear_auth_user() -> None:  # Cleanup (not currently used)
```
- Per-request scoped
- No persistence
- Set by middleware, read by use cases

---

## 8. Auto-Provisioning (backend/app/auth/__init__.py)

### ensure_org_provisioned(user)
Called after successful WorkOS callback if `auto_provision_org=True`:

```python
async def ensure_org_provisioned(user: AuthUser) -> None:
    if not get_settings().auto_provision_org:
        return
    if not user.org_id:
        return
    
    # Check if org exists
    if org already exists:
        return
    
    # Create organization
    org = OrganizationRecord(id=user.org_id, name=user.org_name or "My Organization")
    session.add(org)
    
    # Create default project
    project = ProjectRecord(
        name="My First Project",
        org_id=user.org_id,
        created_by=user.id,
    )
    session.add(project)
    await session.commit()
```

**Scoped to dev/SQLite only** — helps during development

### enrich_org_id(user)
Looks up org_id from projects table when JWT doesn't include it:

```python
async def enrich_org_id(user: AuthUser) -> AuthUser:
    if user.org_id is not None:
        return user  # Already set in JWT
    
    # Query: find any project created_by this user
    result = select(ProjectRecord.org_id)
              .where(ProjectRecord.created_by == user.id)
              .where(ProjectRecord.org_id.isnot(None))
              .limit(1)
    
    org_id = result.scalar_one_or_none()
    if org_id:
        return AuthUser(..., org_id=org_id)
    return user
```

---

## 9. Current Schema State Summary

### Tables with Auth Awareness
| Table | Auth Columns | Scoping Method | Notes |
|-------|--------------|----------------|-------|
| projects | org_id (indexed), created_by | Direct filter on org_id | Multi-tenant root |
| organizations | None (org is container) | Direct ID match | New table (011) |
| datasets | None (inherited via project) | Project.org_id | Cascade ownership |
| transforms | None (inherited via dataset) | Dataset.Project.org_id | Cascade ownership |

### Tables WITHOUT Auth
| Table | Notes |
|-------|-------|
| uploads | File upload metadata |
| outbox_messages | Event outbox pattern |
| (chat_sessions, chat_turns) | Dropped in migration 009 |

### No Session/Token Tables
- No persisted tokens
- No session state in backend DB
- No TTL configuration

---

## 10. Current Limitations & Design Decisions

### By Design (Not Bugs)
1. **JWT-based, stateless auth**: No session database needed
2. **Org-scoping at project level**: Datasets/transforms inherit via FK chain
3. **Repository doesn't enforce auth**: Controllers responsible for checks
4. **Worker owns session state**: Backend delegates chat sessions to worker/Redis

### Implicit Behaviors
1. **enrich_org_id() as fallback**: Allows JWT without org_id claim (custom WorkOS config)
2. **auto_provision_org only in dev**: Not suitable for production
3. **ProjectRecord.org_id nullable**: Allows org-less projects (legacy support)
4. **get_project() bypasses org check**: Must be enforced in controller

### Future Considerations
- Add org_id to datasets/transforms for direct querying (denormalization)
- Add user roles/permissions table (currently org membership is implicit)
- Add audit log table for compliance
