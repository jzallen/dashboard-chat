# UUIDv7 Support and Deterministic Test IDs

## Context

Entity IDs across the backend are `String(36)` columns populated by `str(uuid4())` lambdas. Tests create entities with hardcoded string IDs like `"project-001"` and `"dataset-001"` which are not valid UUIDs. This means:

1. Test assertions can't compare fully hydrated objects — they disaggregate into N property-level assertions, skipping `id` fields because the shape is unpredictable.
2. There's no UUID format validation at the database level, so invalid IDs slip through in dev/test without surfacing bugs that would appear in production.
3. Router-level UUID validation (e.g. `project_id: UUID` in path params) can't be added without breaking the test fixtures.

## Proposal

### 1. Require PostgreSQL 18+ for production

PostgreSQL 18 adds native `uuidv7()` support (committed 2025-04). Use `server_default=func.uuidv7()` on all PK columns instead of Python-side `uuid4()` generation. This gives time-ordered, database-generated IDs without extra extensions.

Migration path:
- Update docker-compose `postgres` service image to `postgres:18`
- Update Alembic `server_default` on all `id` columns to `func.uuidv7()`
- Remove Python-side `default=lambda: str(uuid4())` from ORM models
- Keep `String(36)` column type (UUIDv7 still fits the 36-char hyphenated format)

### 2. Add a deterministic UUIDv7 function for SQLite test databases

Create a custom SQLite function that returns from a pool of ~10 pre-defined UUIDv7-compatible IDs. This gives test fixtures stable, valid UUIDs without needing real time-based generation.

```python
# backend/tests/uuidv7_fixtures.py

# Pre-generated UUIDv7-compatible IDs (time component is fixed, random suffix varies)
# These are valid UUIDv7 format: version nibble = 7, variant bits = 10
TEST_UUIDS = [
    "019515a0-0001-7000-8000-000000000001",  # project-1
    "019515a0-0002-7000-8000-000000000002",  # project-2
    "019515a0-0003-7000-8000-000000000003",  # project-3
    "019515a0-1001-7000-8000-000000000011",  # dataset-1
    "019515a0-1002-7000-8000-000000000012",  # dataset-2
    "019515a0-1003-7000-8000-000000000013",  # dataset-3
    "019515a0-2001-7000-8000-000000000021",  # external-access-1
    "019515a0-2002-7000-8000-000000000022",  # external-access-2
    "019515a0-3001-7000-8000-000000000031",  # user-1
    "019515a0-3002-7000-8000-000000000032",  # user-2
]

_counter = 0

def sqlite_uuidv7():
    """Deterministic UUIDv7 generator for SQLite test databases."""
    global _counter
    result = TEST_UUIDS[_counter % len(TEST_UUIDS)]
    _counter += 1
    return result

def reset_counter():
    """Reset between tests for reproducibility."""
    global _counter
    _counter = 0
```

Register in the SQLite connection event:

```python
@event.listens_for(engine.sync_engine, "connect")
def _register_sqlite_functions(dbapi_conn, connection_record):
    dbapi_conn.create_function("uuidv7", 0, sqlite_uuidv7)
```

### 3. Rewrite test fixtures to use real UUIDs

Replace hardcoded string IDs with the deterministic pool:

```python
# Before
project = ProjectRecord(id="project-001", name="Test", org_id="test-org")
# ...
assert data["project_id"] == "project-001"

# After
from tests.uuidv7_fixtures import TEST_UUIDS

PROJECT_1 = TEST_UUIDS[0]
DATASET_1 = TEST_UUIDS[3]

project = ProjectRecord(id=PROJECT_1, name="Test", org_id=ORG_1)
# ...
assert data == GetSqlAccessResponse(
    project_id=PROJECT_1,
    enabled=True,
    host="pg-duckdb",
    ...
)
```

### 4. Enable full object comparison in assertions

With stable IDs, test assertions can compare complete objects instead of checking properties one at a time:

```python
# Before (disaggregated — fragile, misses fields)
assert data["project_id"] == "project-001"
assert data["enabled"] is True
assert data["host"] is not None
assert data["port"] is not None

# After (full object — catches regressions on any field)
assert result.unwrap() == ExpectedResponse(
    project_id=PROJECT_1,
    enabled=True,
    host=settings.pg_duckdb_host,
    port=settings.pg_duckdb_port,
    database=settings.pg_duckdb_database,
    username="reader_019515a0",
    schema="project_019515a0",
)
```

## Scope

- All ORM models with `id` columns (~6 tables)
- All test conftest.py fixtures across domains (dataset, project, sql_access, controllers)
- Repository tests and use case tests
- Alembic migration for `server_default` change

## Dependencies

- PostgreSQL 18 GA release (expected Q3 2025, already available in beta/RC)
- No frontend changes needed (IDs are opaque strings to the client)

## Priority

Low — this is a test quality improvement. Current tests work fine, they just can't do full object comparison and have to skip ID fields. Worth doing when there's a natural pause between features or when adding a new domain that would benefit from the pattern from day one.
