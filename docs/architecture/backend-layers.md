# Backend Layered Architecture

The backend follows a strict layered architecture where each layer has a single responsibility and dependencies flow inward.

## Layer Diagram

```
HTTP Request
    ↓
┌─────────────────────────────┐
│  Router (FastAPI)           │  Route definitions, input validation, auth guards
├─────────────────────────────┤
│  Controller                 │  HTTP orchestration, response wrapping
├─────────────────────────────┤
│  Use Case                   │  Business logic, domain rules
├─────────────────────────────┤
│  Repository                 │  Data access, storage abstraction
├─────────────────────────────┤
│  Domain Model               │  Frozen dataclasses, business invariants
└─────────────────────────────┘
```

## Routers

Routers define HTTP endpoints and handle request parsing. They delegate to the controller and return responses.

```python
@router.post("", status_code=201)
async def create_project(
    body: CreateProjectRequest,
    user: AuthUser = Depends(get_current_user),
    db=Depends(use_db_context),
):
    result, status = await HTTPController.post_project(body, user)
    return JSONResponse(result, status_code=status)
```

**Responsibilities:**
- Path and method definitions
- Request/response schema (Pydantic models in `routers/schemas/`)
- Dependency injection (`Depends()`) for auth, DB session
- Authorization guards (`authorize_project_access`, `authorize_dataset_access`)

## Controller

A single `HTTPController` class with static methods. It bridges HTTP concerns with use cases.

```python
class HTTPController:
    @staticmethod
    async def post_project(body, user):
        result = await create_project(name=body.name, description=body.description)
        if isinstance(result, Failure):
            return wrap_jsonapi_error(result.failure()), 400
        return wrap_jsonapi_response(result.unwrap().serialize()), 201
```

**Responsibilities:**
- Call use cases with domain arguments (not HTTP objects)
- Map `Success`/`Failure` results to HTTP status codes
- Wrap responses in JSON:API format

## Use Cases

Use cases contain all business logic. They follow a decorator pattern:

```python
@handle_returns       # Outer — wraps return value in Success/Failure
@with_repositories    # Inner — injects RepositoryContainer, auto-commits
async def create_project(
    *,
    name: str,
    description: str | None = None,
    repositories: RepositoryContainer,
) -> Project:
    record = ProjectRecord(id=str(uuid4()), name=name, ...)
    await repositories.metadata.save_project(record)
    return Project.from_record(record)
```

### Decorator Stack

| Decorator | Purpose |
|-----------|---------|
| `@handle_returns` | Catches exceptions and wraps them in `Failure(e)`. Successful returns become `Success(value)`. |
| `@with_repositories` | Creates a `RepositoryContainer`, injects it via `repositories` kwarg, and auto-commits the session on success. |

**Ordering matters:** `@handle_returns` must be the outer decorator so it catches exceptions from both the use case and the repository layer.

### Error Handling

Use cases raise domain exceptions that `@handle_returns` wraps:

```python
class DatasetNotFound(DomainException): ...
class ProjectNotFound(DomainException): ...
class CredentialCooldownError(DomainException): ...
```

The controller checks `isinstance(result.failure(), SomeDomainException)` to map to HTTP status codes.

### Repository Overrides (Testing)

Use cases accept optional `repositories` overrides for testing:

```python
result = await create_project(
    name="test",
    repositories={"metadata_repository": MockMetadataRepo()},
)
```

## Repositories

### RepositoryContainer

Groups all repository types injected into use cases:

- **`metadata`** — CRUD operations on ORM records (projects, datasets, views, etc.)
- **`lake`** — S3/MinIO object storage operations (upload, download, delete Parquet)
- **`outbox`** — Event publishing via the outbox pattern

### RestrictedSession

The metadata repository uses `RestrictedSession` to enforce **multi-tenant isolation**. All queries are automatically scoped by `org_id` from the auth context, preventing cross-tenant data access.

### Outbox Pattern

Write-side events are stored in the `outbox_messages` table within the same transaction as the business operation. A background `sync_processor` polls for unprocessed events and propagates changes (e.g., syncing SQL access views when datasets change).

## Domain Models

All domain models are **frozen dataclasses** (`@dataclass(frozen=True, slots=True)`):

```python
@dataclass(frozen=True, slots=True)
class Dataset:
    id: str
    project_id: str
    name: str
    schema_config: dict
    transforms: list[Transform] = field(default_factory=list)
    ...
```

**Design choices:**
- **Frozen** — immutability prevents accidental state mutation
- **Slots** — memory efficiency and attribute access speed
- **`from_record()`** — factory method to create from ORM records
- **`serialize()`** — converts to JSON-compatible dict for HTTP responses
- Business logic lives on the model (e.g., `Dataset._build_table()` for Ibis SQL generation)
