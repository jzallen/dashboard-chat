## Why

ORM models currently generate UUIDs in Python (`default=lambda: str(uuid7())`) via `uuid_utils`. This means the database has no knowledge of ID generation — raw SQL inserts fail, bulk operations require Python, and the schema doesn't capture the default. PostgreSQL 18 ships a native `uuidv7()` function (built-in, no extension). Moving ID generation to `server_default` makes the database the single source of truth for identity, enables raw SQL workflows, and captures the default in DDL/migrations.

## What Changes

- **BREAKING**: Replace Python-side `default=lambda: str(uuid7())` with `server_default=text("uuidv7()")` on all 6 ORM record ID columns
- Register a custom `uuidv7()` SQL function on SQLite connections so `server_default` works identically across dialects
- Provide three implementations of the SQLite `uuidv7()` function by context:
  - **Dev** (`database.py`): delegates to `uuid_utils.uuid7()` for real random IDs
  - **Dev setup script** (`setup_dev.py`): same, via `uuid_utils`
  - **Tests** (`conftest.py`): delegates to a deterministic pool drawn from `uuidv7_fixtures.py`
- Remove Python-level UUID generation from `create_dataset_from_upload.py` and `create_organization.py`
- Squash all 13 Alembic migrations (001–013) into a single `001_initial_schema.py` generated from current ORM definitions
- Bump Docker Compose PostgreSQL from `postgres:16-alpine` to `postgres:18`

## Capabilities

### New Capabilities
- `db-uuid-generation`: Database-level UUIDv7 generation via `server_default` with dialect-agnostic SQLite shim

### Modified Capabilities
- `uuidv7-id-generation`: Changes from Python-side `default=` to database-side `server_default=text("uuidv7()")`
- `deterministic-test-ids`: SQLite custom function in test conftest draws from the fixture pool instead of generating random IDs

## Impact

- **ORM models**: All 6 record classes lose `from uuid_utils import uuid7` and `default=` parameter; gain `server_default=text("uuidv7()")`
- **database.py**: Adds SQLite `"connect"` event hook registering `uuidv7()` custom function
- **tests/conftest.py**: Adds SQLite `"connect"` event hook with deterministic pool-based `uuidv7()` function
- **Alembic migrations**: All 13 files deleted and replaced with a single `001_initial_schema.py`
- **Docker Compose**: `postgres:16-alpine` bumped to `postgres:18`; `db` service stays behind profile (SQLite dev still works)
- **Use cases**: `create_dataset_from_upload.py` and `create_organization.py` stop generating UUIDs in Python
- **Dependencies**: `uuid_utils` remains (used by SQLite shim in `database.py`) but removed from all model files
- **No API changes**: Column type stays `String(36)`, router path params stay `str`
- **No frontend changes**: IDs are opaque strings to the client
