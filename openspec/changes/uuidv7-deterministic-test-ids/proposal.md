## Why

Entity IDs across the backend use `uuid4()` defaults and test fixtures use hardcoded non-UUID strings like `"project-001"`. This prevents full object comparison in test assertions (tests must skip `id` fields), makes it impossible to add UUID format validation, and means test data doesn't match production ID shapes. Switching to UUIDv7 also gives time-ordered IDs, which improves index locality and enables chronological sorting by primary key.

## What Changes

- Switch 4 ORM model ID defaults from `uuid4()` to `uuid7()` using the already-installed `uuid-utils` package (OutboxRecord already uses `uuid7()`)
- Add a `uuid7()` default to DatasetRecord, which currently has no default (caller-supplied)
- Create a deterministic UUIDv7 test ID pool in `backend/tests/uuidv7_fixtures.py` with named constants for every entity type
- Migrate all 7 test conftest files from hardcoded string IDs to the deterministic UUIDv7 pool
- Update test assertions to reference named constants instead of magic strings

## Capabilities

### New Capabilities
- `uuidv7-id-generation`: ORM models generate UUIDv7 IDs by default using Python-side `uuid7()` from `uuid-utils`
- `deterministic-test-ids`: Test fixtures use a shared pool of pre-generated, valid UUIDv7 constants for all entity types

### Modified Capabilities
None. No existing specs are affected.

## Impact

- **ORM models**: `ProjectRecord`, `DatasetRecord`, `TransformRecord`, `OrganizationRecord`, `ExternalAccessRecord` gain `uuid7()` defaults
- **Test fixtures**: All 7 conftest files under `backend/tests/` updated to use UUIDv7 constants
- **Test assertions**: References to hardcoded IDs (`"project-001"`, `"dataset-001"`, etc.) replaced with named constants
- **No API changes**: Router path params remain `str`, column type stays `String(36)` -- fully backward compatible
- **No migration needed**: Only Python-side defaults change; no database schema changes
- **No frontend changes**: IDs are opaque strings to the client
- **Dependencies**: `uuid-utils>=0.6.0` already in `pyproject.toml`
