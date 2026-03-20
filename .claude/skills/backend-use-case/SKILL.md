---
name: backend-use-case
description: Use when creating or modifying a backend use case, controller, or repository in this project. Covers decorator stack order, RepositoryContainer usage, org_id scoping, RestrictedSession rules, error handling, and test setup patterns.
---

# Backend Use Case Pattern

## Overview

Backend business logic lives in `app/use_cases/<domain>/` and follows a strict decorator + dependency injection pattern. Getting the order wrong silently breaks commits and error handling.

## Decorator Stack

Always apply decorators in this order — `@with_repositories` outermost, `@handle_returns` innermost:

```python
@with_repositories    # outer — injects RepositoryContainer, commits on success / rolls back on failure
@handle_returns       # inner — catches exceptions, wraps as Success(value) or Failure(exception)
async def create_thing(name: str, *, user: AuthUser, repositories: "RepositoryContainer") -> Thing:
    thing = await repositories.metadata.things.create(name=name, org_id=user.org_id)
    return thing
```

**Never swap the order.** `with_repositories` must wrap `handle_returns` so the session commit happens after the result is determined.

## Function Signature Rules

- `repositories: "RepositoryContainer"` is **keyword-only** (`*` separator) and injected by the decorator — never pass it manually except in tests
- `user: AuthUser` is typically required and passed explicitly from the controller
- Use string annotation `"RepositoryContainer"` to avoid circular imports

## RepositoryContainer Access

```python
repositories.metadata   # MetadataRepository — SQLAlchemy ORM (projects, datasets, reports...)
repositories.lake       # LakeRepository — DuckDB/Ibis for analytical queries
repositories.outbox     # OutboxRepository — transactional outbox messages
```

Repos are lazily instantiated and cached on first access within the request.

## RestrictedSession Rule

Repository methods must only call `session.flush()`, **never** `session.commit()`. The `@with_repositories` decorator owns the commit lifecycle. Committing inside a repo bypasses rollback on failure.

## org_id Scoping

**Always** pass `user.org_id` to repository create/list methods:

```python
# ✅ Correct
items = await repositories.metadata.things.list(org_id=user.org_id)
thing = await repositories.metadata.things.create(name=name, org_id=user.org_id)

# ❌ Wrong — leaks cross-tenant data
items = await repositories.metadata.things.list()
```

Exception: fetching by primary key is OK without org_id only if a prior ownership check has confirmed tenancy.

## Error Handling

Raise domain exceptions (subclassing `DomainException`). `handle_returns` catches them automatically:

```python
from app.exceptions import DomainException

class ThingNotFound(DomainException):
    pass

async def get_thing(thing_id: str, *, user: AuthUser, repositories: "RepositoryContainer"):
    thing = await repositories.metadata.things.get(thing_id, org_id=user.org_id)
    if thing is None:
        raise ThingNotFound(f"Thing {thing_id} not found")
    return thing
```

## Full Request Flow

```
Router (app/routers/)
  → Controller (app/controllers/) — extracts user, path/body params
    → Use case — business logic
      → Repository — data access (flush only)
  ← Controller wraps result: wrap_jsonapi_single(data) or _error_response(error)
```

Controller pattern:
```python
class ThingController(HTTPController):
    async def get(self, thing_id: str, user: AuthUser = Depends(get_auth_user)):
        result = await get_thing(thing_id, user=user)
        match result:
            case Success(data):
                return wrap_jsonapi_single(data, ThingSchema)
            case Failure(error):
                return self._error_response(error)
```

## Test Setup

```python
# conftest.py — autouse fixture (org-wide)
@pytest.fixture(autouse=True)
async def setup_auth(db_session):
    set_session(db_session)      # required before any use case call
    set_auth_user(TEST_USER)     # TEST_USER has id="test-user-001", org_id="test-org-001"

# individual test
async def test_create_thing(db_session):
    result = await create_thing(name="my thing", user=TEST_USER)
    match result:
        case Success(data):
            assert data.name == "my thing"
        case Failure(error):
            pytest.fail(f"Unexpected failure: {error}")

# asserting on failure type
async def test_thing_not_found():
    result = await get_thing("nonexistent-id", user=TEST_USER)
    assert isinstance(result.failure(), ThingNotFound)
    # or: assert "not found" in str(result.failure())

# repository override in test
async def test_with_mock_repo():
    result = await create_thing(
        name="x",
        user=TEST_USER,
        repositories={"metadata_repository": MockMetadataRepo},  # value is callable/class
    )
```

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| `@handle_returns` outer, `@with_repositories` inner | Swap — `@with_repositories` must be outermost |
| Calling `session.commit()` in a repo method | Use `session.flush()` only |
| Querying without `org_id` in list/create | Always pass `user.org_id` |
| `result.failure()` with `==` comparison | Use `isinstance(result.failure(), SomeDomainException)` |
| Passing `repositories=container_instance` in test | Pass `repositories={"key": MockClass}` (dict of callables) |
| Forgetting `set_session(db_session)` in test | Add to autouse conftest fixture |

## Reference Files

- `backend/app/repositories/__init__.py` — decorators, RepositoryContainer, RestrictedSession
- `backend/app/use_cases/__init__.py` — `handle_returns` implementation
- `backend/app/auth/context.py` — `set_auth_user` / `get_auth_user` / `set_session`
- `backend/app/use_cases/project/create_project.py` — canonical example
- `backend/app/controllers/http_controller.py` — controller base class
- `backend/tests/use_cases/project/test_create_project.py` — test pattern
