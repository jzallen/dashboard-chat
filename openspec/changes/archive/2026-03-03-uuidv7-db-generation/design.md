## Context

The predecessor change (`uuidv7-deterministic-test-ids`) moved ORM defaults from `uuid4()` to `uuid7()` in Python and created a deterministic test ID pool. That change explicitly deferred database-level `server_default` as a non-goal (D1: "PG 16 lacks native `uuidv7()`").

PostgreSQL 18 (released Sept 2025) ships a built-in `uuidv7()` function — no extension required. The project's Docker Compose currently uses `postgres:16-alpine`. SQLite is the default dev database; PostgreSQL is behind `--profile full`. Tests use in-memory SQLite via `tests/conftest.py`.

Current ID generation:
- 6 ORM records: `default=lambda: str(uuid7())` via `uuid_utils`
- `create_dataset_from_upload.py`: `id=str(uuid7())` inline (needs ID pre-insert for `storage_path`)
- `create_organization.py` (dev mode): `str(uuid4())` inline
- 13 Alembic migrations, no production database

## Goals / Non-Goals

**Goals:**
- Make the database the authority for ID generation via `server_default=text("uuidv7()")`
- Produce identical generated SQL across PostgreSQL and SQLite dialects
- Register a custom `uuidv7()` SQL function in SQLite backed by `uuid_utils` for dev
- Register a custom `uuidv7()` SQL function in SQLite backed by the deterministic fixture pool for tests
- Squash 13 migrations into one initial schema that captures the `server_default`
- Bump Docker Compose PostgreSQL to version 18
- Remove Python-side UUID generation from ORM model defaults and use case code

**Non-Goals:**
- Changing column type from `String(36)` to SQLAlchemy `Uuid` (complicates SQLite compatibility)
- Dropping SQLite support for local dev (the shim preserves current DX)
- Removing `uuid_utils` from dependencies (still needed for the SQLite shim)
- Frontend or API contract changes (IDs remain opaque strings)

## Decisions

### D1: `server_default=text("uuidv7()")` with SQLite custom function shim

**Decision**: Use `server_default=text("uuidv7()")` on all ID columns. Register a Python-backed `uuidv7()` function on SQLite connections via SQLAlchemy's `"connect"` event. PostgreSQL 18 provides the function natively.

**Rationale**: This produces identical SQL for both dialects. SQLAlchemy's SQLite DDL compiler automatically wraps expression defaults in parentheses (`DEFAULT (uuidv7())`), so `text("uuidv7()")` renders valid DDL everywhere. No `::text` cast is needed because the column is `String(36)` — PostgreSQL implicitly casts the `uuid` return to text on assignment.

**Alternatives considered**:
- `server_default=text("uuidv7()::text")`: Explicit cast is PostgreSQL-specific, breaks SQLite
- `server_default=func.uuidv7()`: SQLAlchemy `func` renders identically to `text()` but adds import noise with no benefit
- Conditional `server_default` per dialect: Violates the goal of identical SQL

### D2: Three implementations of the SQLite `uuidv7()` function by context

**Decision**: The same SQL function name (`uuidv7`) is backed by different Python callables depending on context:

| Context | Registration site | Backing implementation |
|---------|------------------|----------------------|
| Dev/production SQLite | `database.py` event hook | `lambda: str(uuid_utils.uuid7())` |
| Dev setup script | `setup_dev.py` event hook | `lambda: str(uuid_utils.uuid7())` |
| Tests | `tests/conftest.py` event hook | Closure over an auto-incrementing counter producing deterministic UUIDv7 strings |

**Rationale**: The dev shim produces real random UUIDv7s for realistic local behavior. The test shim produces deterministic IDs so tests that omit explicit IDs still get reproducible values. The counter uses a dedicated segment (`019515a0-f0xx`) to be visually distinct from the explicit fixture pool (`0xxx`–`5xxx`).

**Alternatives considered**:
- Single implementation everywhere: Loses test determinism
- Skip SQLite shim, require PostgreSQL for dev: Degrades DX for quick local iteration

### D3: Test deterministic pool uses auto-incrementing counter in `f` segment

**Decision**: The test `uuidv7()` SQLite function uses a closure with an incrementing counter:

```python
def _make_test_uuidv7():
    counter = 0
    def _generate():
        nonlocal counter
        counter += 1
        return f"019515a0-f{counter:03x}-7000-8000-{counter:012x}"
    return _generate
```

This produces values like `019515a0-f001-7000-8000-000000000001`, `019515a0-f002-7000-8000-000000000002`, etc.

**Rationale**: The `f` segment prefix distinguishes auto-generated IDs from the explicit domain-segmented fixtures (`0xxx`=projects, `1xxx`=datasets, etc.). If an auto-generated ID appears in a test failure, it's immediately clear it came from the `server_default` rather than an explicit fixture. The counter is session-scoped and resets per test (since each test gets a fresh SQLite database + engine).

**Alternatives considered**:
- Random UUIDs in tests: Non-deterministic, can't assert on exact values
- Drawing from the named fixture pool: The function doesn't know the table context, can't domain-segment
- No test shim (rely on explicit IDs only): `CREATE TABLE ... DEFAULT (uuidv7())` would fail on SQLite, making DDL generation error

### D4: Squash all migrations into one, autogenerate from ORM

**Decision**: Delete all 13 migration files. Run `alembic revision --autogenerate` against the updated ORM models to produce a single `001_initial_schema.py`. Manually review and fix the output (autogenerate sometimes misses indexes or renders defaults incorrectly).

**Rationale**: No production database exists. The 13 migrations contain intermediate states (table renames, column type changes, table creation+deletion) that are historical noise. A single migration matching the current ORM is cleaner, faster, and captures the new `server_default`.

**Alternatives considered**:
- Add migration 014 on top of existing chain: Preserves history nobody needs; the `server_default` addition generates a complex ALTER for every table
- Keep migrations and add a squash marker: Alembic squash tooling is manual and error-prone

### D5: `create_dataset_from_upload` pre-fetches ID from database

**Decision**: Add a repository method `generate_id()` that executes `SELECT uuidv7()` (PostgreSQL) or calls the registered SQLite function. The `create_dataset_from_upload` use case calls this to get an ID before constructing the `Dataset` domain object.

**Rationale**: The `Dataset` domain object needs an ID to compute `storage_path = f"{project_id}/{dataset_id}.parquet"`. Pre-fetching from the DB keeps the database as the ID authority while preserving the current data flow. It's one extra query but avoids restructuring the insert-then-update pattern.

**Alternatives considered**:
- Restructure: insert record without storage_path, get ID, update record: Two writes, more complex transaction
- Keep Python-side uuid7() for this one case: Inconsistent, defeats the purpose
- Compute storage_path after insert via RETURNING: Requires changing the metadata repository contract

### D6: Bump PostgreSQL to 18, keep as optional profile

**Decision**: Change Docker Compose `db` service from `postgres:16-alpine` to `postgres:18`. Keep it behind `--profile full` / `--profile postgres`. SQLite remains the zero-dependency default for local dev.

**Rationale**: The SQLite shim means dev doesn't require PostgreSQL. But when running with `--profile full`, the database should have native `uuidv7()`. Bumping to 18 enables this without changing the default DX.

## Risks / Trade-offs

- **[Risk] Alembic autogenerate fidelity**: Autogenerate may render `server_default` as a raw string instead of `text()`, or miss some indexes.
  - **Mitigation**: Manually review the generated migration. Compare `Base.metadata` tables against the migration ops.

- **[Risk] SQLite function registration timing**: If `create_all` runs before the event hook fires, DDL with `DEFAULT (uuidv7())` could fail.
  - **Mitigation**: The `"connect"` event fires on connection creation, before any SQL executes. `create_all` uses the same engine, so the function is always registered first.

- **[Risk] Test counter reset**: If a test reuses the same engine/connection across multiple test functions, the counter doesn't reset.
  - **Mitigation**: Each `db_session` fixture creates a new engine + temp file, so the event hook re-registers and the closure resets.

- **[Trade-off] `uuid_utils` stays as a dependency**: It's only used for the SQLite dev shim now, but can't be removed until SQLite dev support is dropped.
  - **Acceptable**: It's a small, well-maintained package with no transitive dependencies.

- **[Trade-off] Extra query in `create_dataset_from_upload`**: Pre-fetching an ID adds one `SELECT` per dataset creation.
  - **Acceptable**: Dataset creation is already I/O-heavy (CSV parse, Parquet write, S3 upload). One lightweight SELECT is negligible.
