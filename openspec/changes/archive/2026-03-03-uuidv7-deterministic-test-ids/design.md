## Context

Entity IDs are currently generated with `uuid4()` in Python-side ORM defaults. The `OutboxRecord` and `create_dataset_from_upload` already use `uuid7()` from `uuid-utils`. Test fixtures use hardcoded non-UUID strings (`"project-001"`, `"dataset-001"`, etc.) that don't match production ID format, preventing full object comparison in assertions.

The project runs PostgreSQL 16-alpine (not 18), so native `uuidv7()` server defaults are not available. The `uuid-utils>=0.6.0` package is already installed. All ID columns use `String(36)` and all router path params are `str`, so no schema or API changes are needed.

## Goals / Non-Goals

**Goals:**
- Standardize all ORM models on `uuid7()` for time-ordered, valid UUID IDs
- Add a `uuid7()` default to `DatasetRecord` (currently has no default -- caller-supplied)
- Replace all hardcoded test IDs with a shared pool of valid, deterministic UUIDv7 constants
- Enable full object comparison in test assertions (no more skipping `id` fields)

**Non-Goals:**
- PostgreSQL `server_default=func.uuidv7()` (requires PG 18+, out of scope)
- Alembic migration (column type stays `String(36)`, only Python defaults change)
- Frontend changes (IDs are opaque strings to the client)
- Changing the `create_organization` use case's inline `uuid4()` call (that's a WorkOS fallback path, not an ORM default)
- Upgrading existing data in the database (new defaults only apply to new records)

## Decisions

### D1: Python-side uuid7() only (no database server_default)

**Decision**: Use `default=lambda: str(uuid7())` on ORM columns. No Alembic migration.

**Rationale**: PG 16 lacks native `uuidv7()`. Adding a server_default via a custom SQL function adds complexity with no benefit -- the Python default already runs before INSERT. When PG 18+ is adopted, a future change can add `server_default` and remove the Python default.

**Alternatives considered**:
- PG extension (`pg_uuidv7`): Adds external dependency, complicates CI/CD
- Wait for PG 18 upgrade: Delays the test quality improvements unnecessarily

### D2: DatasetRecord gets a default, callers keep explicit ID generation

**Decision**: Add `default=lambda: str(uuid7())` to `DatasetRecord.id`. Existing callers that pass explicit `dataset_id` (like `create_dataset_from_upload.py`) continue to work since explicit values override defaults.

**Rationale**: The DatasetRecord is the only model without an ID default. Adding one makes it consistent with the other 5 models and means test fixtures can omit the `id=` parameter if they don't need a specific value.

### D3: Named constants in a shared fixture module (not counter-based generator)

**Decision**: Create `backend/tests/uuidv7_fixtures.py` with a flat set of named constants (e.g., `PROJECT_1`, `DATASET_1`, `USER_1`). No counter, no generator function, no SQLite custom function registration.

**Rationale**: Named constants are simpler, greppable, and don't depend on call order. A counter-based generator (as in the backlog doc) introduces test-order sensitivity. Constants also appear in assertion error messages, making failures easier to debug.

**Alternatives considered**:
- Counter-based `sqlite_uuidv7()`: Order-dependent, harder to debug
- `uuid7()` called fresh in each fixture: Non-deterministic, can't assert on exact IDs
- Inline UUIDs in each conftest: Duplicated, harder to maintain

### D4: UUIDv7 values use recognizable suffixes per entity domain

**Decision**: Use a fixed timestamp prefix with domain-segmented random suffixes so IDs are visually distinguishable in logs and test output:
- `019515a0-0001-7...` for projects
- `019515a0-1001-7...` for datasets
- `019515a0-2001-7...` for transforms
- `019515a0-3001-7...` for users/auth
- `019515a0-4001-7...` for organizations
- `019515a0-5001-7...` for external access

**Rationale**: When a test fails, seeing `019515a0-0002-7000-8000-000000000002` immediately tells you it's "project #2" without looking up the constant name.

## Risks / Trade-offs

- **[Risk] Test churn**: Touching 7 conftest files and many assertion lines in one change is a large diff.
  - **Mitigation**: Organize tasks per conftest file so each is independently reviewable. Run full test suite after each file migration.

- **[Risk] Missed hardcoded IDs**: Some test files may reference IDs inline (not just conftest).
  - **Mitigation**: Use `grep` to find all occurrences of old ID patterns (`project-001`, `dataset-001`, etc.) before marking migration complete.

- **[Risk] Storage path coupling**: Some tests construct storage paths using the old IDs (e.g., `"project-001/dataset-001.parquet"`). Changing IDs means storage paths change.
  - **Mitigation**: Storage paths in tests should also use the new constants: `f"datasets/{PROJECT_1}/{DATASET_1}/"`.

- **[Trade-off] Pre-generated vs dynamic IDs**: Pre-generated constants sacrifice flexibility (can't easily add more) for determinism and debuggability. This is the right trade-off for a test suite of this size.
