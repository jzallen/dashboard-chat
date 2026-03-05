# Design: Use Case Connascence Reduction

## Architecture Overview

This change reduces coupling strength across the use case and repository layers without introducing new abstractions. Each item converts a stronger form of connascence into a weaker one.

```
Connascence of Meaning  ──→  Connascence of Type    (items 3, 4)
Connascence of Algorithm ──→  Connascence of Name    (item 2)
Connascence of Meaning  ──→  Connascence of Name    (item 1)
```

---

## Decision 1: Status Literal → Enum

### Current State

`enable_sql_access.py:211` passes `environment_status="running"` (string literal) to `external_access_repo.create()`. All other sites use `Status.RUNNING`.

### Target State

Replace with `environment_status=Status.RUNNING`.

### Why Not Change the Repository to Accept the Enum

The `ExternalAccessRepository.create()` signature takes `str | None` because the ORM column is a string. Converting the entire column to use the enum type is out of scope — that would require an Alembic migration and affect the ORM model. The fix here is at the call site only.

---

## Decision 2: Upload Auth via ProjectService

### Current State

`upload_file.py` has three authorization-related operations:
1. `_validate_references(metadata_repo, project_id, dataset_id)` — checks existence
2. `metadata_repo.get_project(project_id)` — fetches project for org check
3. Inline org_id comparison

### Target State

Replace steps 2-3 with `ProjectService(repositories).fetch_and_authorize_project(project_id)`.

Step 1 (`_validate_references`) partially overlaps — it checks `project_exists()` which `ProjectService` also does (via `get_project` + `None` check). However, `_validate_references` also checks `dataset_exists()` when a `dataset_id` is provided.

### Approach

Simplify `_validate_references` to only handle the dataset existence check. Project existence and authorization are fully handled by `ProjectService`:

```python
# Before
_validate_upload(file_content, file_name)
await _validate_references(metadata_repo, project_id, dataset_id)
project = await metadata_repo.get_project(project_id, include_datasets=False)
user = get_auth_user()
if project and project.get("org_id") and project["org_id"] != user.org_id:
    raise AuthorizationError(...)

# After
_validate_upload(file_content, file_name)
project_service = ProjectService(repositories)
await project_service.fetch_and_authorize_project(project_id)
if dataset_id:
    await _validate_dataset_exists(metadata_repo, dataset_id)
```

This eliminates the redundant project fetch and the inline auth check.

---

## Decision 3: Typed RepositoryContainer Properties

### Current State

```python
class RepositoryContainer:
    def __getitem__(self, name: str) -> object:
        ...
```

Callers: `repositories["metadata_repository"]` — returns `object`, requires cast or annotation at each site.

### Target State

```python
class RepositoryContainer:
    @property
    def metadata(self) -> MetadataRepository:
        return self["metadata_repository"]  # type: ignore[return-value]

    @property
    def lake(self) -> LakeRepository:
        return self["lake_repository"]  # type: ignore[return-value]

    @property
    def outbox(self) -> OutboxRepository:
        return self["outbox_repository"]  # type: ignore[return-value]

    @property
    def external_access(self) -> ExternalAccessRepository:
        return self["external_access_repository"]  # type: ignore[return-value]

    def __getitem__(self, name: str) -> object:
        ...  # unchanged, retained for test overrides
```

### Why Properties, Not Typed __getitem__ Overloads

Python's `__getitem__` doesn't support overloading by string literal type in a way that mypy/pyright can resolve without `Literal` unions and `@overload` decorators — which would be more complex than simple properties and harder to read.

### Why Retain __getitem__

The test override mechanism passes `repositories={'metadata_repository': MockRepo}` as a dict, which `with_repositories` converts into a `RepositoryContainer(db, overrides)`. The overrides dict uses the string keys. Removing `__getitem__` would require changing the test override API, which is out of scope.

### Migration Strategy

Mechanical find-and-replace across all use case files and services. Each `repositories["metadata_repository"]` becomes `repositories.metadata`. Local type annotations become unnecessary since the property provides the type.

---

## Decision 4: Typed AccessRecordView Dataclass

### Current State

`ExternalAccessRepository._to_dict()` returns `dict[str, Any]`. Consumers across 10 files do `access_record["pg_schema"]`, `access_record["environment_port"]`, etc.

### Target State

Two frozen dataclasses in `app/repositories/external_access.py`:

```python
@dataclass(frozen=True)
class AccessRecordView:
    id: str
    project_id: str
    org_id: str
    pg_schema: str
    pg_role: str
    environment_id: str | None
    environment_host: str | None
    environment_port: int | None
    proxy_container_id: str | None
    environment_status: str | None
    status_message: str | None
    enabled: bool
    is_legacy: bool
    last_synced_at: str | None
    created_at: str | None
    updated_at: str | None

@dataclass(frozen=True)
class AccessRecordWithHash(AccessRecordView):
    pg_password_hash: str = ""
```

### Why Dataclass, Not the ORM Record Directly

Returning `ExternalAccessRecord` (the ORM model) would couple use cases to SQLAlchemy session lifecycle — accessing lazy-loaded attributes outside the session scope raises `DetachedInstanceError`. The dataclass is a clean, session-independent value object.

### Why Not TypedDict

`TypedDict` preserves dict-style access (`record["key"]`), which doesn't improve the connascence — it just adds type hints to the same pattern. Dataclass attribute access (`record.key`) is a stronger improvement because typos become `AttributeError` at attribute resolution time and IDEs provide autocomplete.

### Why frozen=True

Access records are query results — they represent a point-in-time snapshot. Mutation would be misleading since changes don't propagate back to the database. Freezing prevents accidental mutation and makes the intent clear.

### Impact on Tests

Tests that construct mock `access_record` dicts will change to `AccessRecordView(...)` or `AccessRecordWithHash(...)` constructor calls. This is a mechanical change — the field names are identical.

### `is_legacy` Computation

Currently computed in `_to_dict` as `enabled and proxy_container_id is None`. In the dataclass, this is computed at construction time and stored as a regular field. The factory method in `_to_dict` (renamed to `_to_view`) computes and passes it to the constructor.

---

## Implementation Sequence

The four items are independent and can be committed separately. Recommended order minimizes intermediate churn:

```
Phase 1: Status literal fix           (1 line change, no dependencies)
Phase 2: Upload auth consolidation    (1 file + tests, no dependencies)
Phase 3: Typed RepositoryContainer    (1 file + 35 call sites, no dependencies on 1-2)
Phase 4: Typed AccessRecordView       (1 file + 30 call sites + tests, no dependencies on 1-3)
Phase 5: Verification                 (full test suite, linting)
```

Phases 1-2 are small, targeted fixes. Phases 3-4 are broader mechanical migrations. Each phase is a single commit.
