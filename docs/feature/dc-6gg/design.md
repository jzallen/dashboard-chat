# Design Plan — Dataset preview path needs MinIO secret in pg_duckdb

> **Status:** design accepted, awaiting implementation by polecat under `/nw-bugfix`.
> **Source bead:** `hq-c2u` (mayor's design ask).
> **Implementation bead:** see end of this document.

## 1. Problem framing

`GET /api/datasets/{id}?include_preview=true` returns **500** because pg_duckdb has no S3 secret on the connection used by the dataset-preview path. The query
hits AWS S3 default endpoint with empty region (HTTP 404) instead of the local
MinIO. The parquet exists in MinIO; the dataset metadata pane stays blank in the
UI.

## 2. Code-level findings

What the bead description posited matches the code, with one important
correction:

- **`backend/app/repositories/lake/repository.py`** (`BaseLakeRepository.read_parquet_preview`, `get_parquet_row_count`, `get_parquet_column_type`, `preview_cleaning_operation`) connects via `database.get_query_engine_pool()` (asyncpg, admin creds) and runs `SELECT * FROM read_parquet('s3://…')`. **No S3 secret is ever set on this pool.** This is the path that 500s.
- **`backend/app/use_cases/sql_access/_infra/pg_duckdb_manager.py::configure_s3_secrets()`** runs `CREATE OR REPLACE PERSISTENT SECRET minio_secret(...)` via `duckdb.raw_query()`. **Correction to the bead description:** this function has *zero* production callers today (`grep -rn configure_s3_secrets backend/app/`). It is exported from `app/use_cases/sql_access/_infra/__init__.py`, only one test exercises it (`test_pg_duckdb_manager.py:200`). Whatever workflow once invoked it has been removed, so today *no path in the app* writes a MinIO secret to pg_duckdb.
- **`backend/sql/init-query-engine.sql`** runs at first container init: installs `httpfs`, creates the `duckdb_readers` group role, sets `duckdb.postgres_role`. **No secret seeding.**
- **`backend/app/use_cases/sql_access/sql_access_service.py::build_storage_config()`** already centralises the settings-to-`StorageConfig` translation (prefers `minio_internal_endpoint`, falls back to `minio_endpoint`). Reusable as-is.
- **`backend/app/database.py::get_query_engine_pool()`** is the single chokepoint creating the asyncpg pool to the query engine. Lazy, called once.

## 3. Options

### Option A — Seed default secret in `init-query-engine.sql`

Bake `CREATE OR REPLACE PERSISTENT SECRET minio_secret (...)` into the
initdb SQL, fed by env vars on the query-engine container.

- **Pros:** Persistent on the duckdb side; one place; runtime app code stays
  ignorant of bootstrap.
- **Cons:**
  - SQL files in `docker-entrypoint-initdb.d` cannot interpolate env vars
    natively — needs a shell wrapper that templates the SQL or injects
    via `psql -v`. Adds an extra moving part.
  - Splits credential ownership across two containers: the FastAPI app
    already has `MINIO_*` settings; now the **query-engine container** also
    needs them. Two sources of truth for the same secret.
  - Init script runs **once** on first volume creation. If creds rotate or
    the secret is dropped manually, recovery requires either a re-init
    (data loss on the volume) or an out-of-band fix.
  - No story for tests — test fixtures that boot a fresh query engine
    would need their own templating.

### Option B — Ensure secret on `get_query_engine_pool()` initialization (RECOMMENDED)

When the asyncpg pool is first created in `database.py`, run a one-time
`CREATE OR REPLACE PERSISTENT SECRET minio_secret (...)` against an admin
connection from the pool, sourced from app settings.

- **Pros:**
  - **Single source of truth** for credentials: app settings (`MINIO_*`) — the
    same place the boto3 client in `MinIOLakeRepository.__init__` reads from.
  - Self-healing: rotating creds in env restores the secret on next pool
    rebuild (process restart). No data-volume coupling.
  - Idempotent (`CREATE OR REPLACE`) so concurrent calls are safe.
  - Reuses the *already-existing* `build_storage_config()` and the existing
    secret SQL builder (extracted from `configure_s3_secrets`).
  - Test surface is at the natural seam — the query-engine pool factory.
- **Cons:**
  - Couples `database.py` (runtime) to a one-time bootstrap step. Minor:
    the file already does lazy initialization (`_init_engine`, the asyncpg
    pool, sqlite uuidv7 registration), so this is consistent.
  - First request after process start pays a small one-time latency cost
    (one extra round-trip to the query engine).

### Option C — Route lake-repo path through the SQL-access provisioner

Make `BaseLakeRepository._get_query_engine_pool()` go through
`QueryEngineProvisioner` so the same provisioning that prepares per-project
schemas also configures S3.

- **Pros:** Single conceptual path to the query engine.
- **Cons:**
  - The lake repo is **not project-scoped** — it serves admin-level reads
    for *all* dataset previews, including projects that never enabled SQL
    access. The provisioner is project-scoped and lifecycle-coupled to
    `enable_sql_access`. Conflating the two is a category error.
  - Largest blast radius of the three options; touches use cases that
    currently do not depend on each other.
  - Does not actually fix the bug any better than B — secrets are still
    instance-global persistent secrets either way.

## 4. Chosen option + rationale

**Option B.** It puts the fix in the file that already owns query-engine
connection lifecycle (`database.py`), keeps credentials in one place
(app settings), is idempotent and self-healing, and aligns with how
`MinIOLakeRepository` already sources MinIO config. The implementation is
small, the test seam is natural, and the change is scoped strictly to what
the bug requires.

A small refactor is bundled in: extract the secret-setting SQL from
`sql_access/_infra/pg_duckdb_manager.py::configure_s3_secrets` into a
neutral helper that does **not** live under `sql_access/` (because
PERSISTENT SECRETs are server-wide, not sql_access-specific). Keep the
old function as a thin re-export so existing tests stay green and the
public API of `sql_access._infra` is not silently broken.

## 5. Acceptance criteria (for the polecat)

```gherkin
Feature: Dataset preview reads parquet from MinIO

  Scenario: Preview returns rows on a fresh query-engine boot
    Given all dev services are up via `make up`
      And a freshly-booted query-engine container with no prior persistent secret
      And a project with one CSV uploaded as parquet to MinIO
    When the API serves GET /api/datasets/{id}?include_preview=true
    Then the response status is 200
      And the response body contains preview_rows with at least one row
      And api logs contain no "PGDuckDB/CreatePlan ... HTTP 404" error

  Scenario: Pool rebuild after credential rotation
    Given the FastAPI app has been restarted with rotated MINIO_SECRET_KEY
    When the lake repository serves the next preview request
    Then the persistent secret reflects the new credentials
      And the request succeeds
```

## 6. Test surface

### Existing coverage (preserve, do not modify to make green — Iron Rule)

- `backend/tests/use_cases/sql_access/test_pg_duckdb_manager.py:200` —
  asserts the secret SQL contains `PERSISTENT`. Keep passing after the
  helper is moved (re-export keeps the call site valid).
- `backend/tests/use_cases/dataset/test_get_dataset.py:77` —
  unit-level test for `include_preview=True` path with `query_preview_rows`
  mocked. Stays green; this test does not exercise the live pool.

### New regression tests (write FIRST, RED before fix)

1. **Acceptance test (Outside-In, RED_ACCEPTANCE):** integration test in
   `backend/tests/integration/` (create the directory if absent) that:
   - Boots the dev compose stack (or a minimal subset: minio + query-engine + api).
   - Uploads a parquet to MinIO at the dataset's storage path.
   - Calls `GET /api/datasets/{id}?include_preview=true`.
   - Asserts 200 + non-empty `preview_rows`.

   No mocks at the lake-repo layer. This is the **port-level** test
   (HTTP boundary in, MinIO + query engine real). If a docker-compose
   integration harness does not yet exist, gating this on a `pytest`
   marker (e.g. `@pytest.mark.docker_compose`) is acceptable — but the
   test must exist and run in CI's integration job.

2. **Unit test (RED_UNIT) at the pool-init seam:**
   `backend/tests/test_database.py` (create if absent) — assert that
   creating the query-engine pool issues exactly one
   `CREATE OR REPLACE PERSISTENT SECRET minio_secret(...)` statement
   with the expected fields (endpoint, region, url_style, use_ssl)
   sourced from settings.

   Use a fake/spy asyncpg connection (do not mock internals of the
   helper module — only the asyncpg seam, which is a true port).

### Hexagonal seam discipline

- The port is **`asyncpg.create_pool` → first connection acquisition**.
  Spy at that boundary; do not patch internal functions of the helper
  module.
- `MinIOLakeRepository` already follows the same pattern (boto3 client
  is the port, swappable via constructor). The new init step lives one
  layer below — at pool construction — and should be testable the same
  way.

## 7. Implementation sketch (for the polecat — non-prescriptive)

A reasonable shape:

```
backend/app/infra/query_engine_secrets.py     # new module
    async def ensure_minio_secret(conn, storage_config) -> None: ...
    SECRET_SQL = "SELECT duckdb.raw_query($q$ ... $q$)"

backend/app/database.py
    # in get_query_engine_pool, after pool creation:
    async with _query_engine_pool.acquire() as conn:
        await ensure_minio_secret(conn, build_storage_config())

backend/app/use_cases/sql_access/_infra/pg_duckdb_manager.py
    # configure_s3_secrets becomes a thin wrapper around
    # ensure_minio_secret to preserve the existing public API + test.
```

The polecat may pick a different shape, as long as:
- Credentials flow from `Settings` → `build_storage_config()` → secret SQL.
- The fix lives at or below `database.py`'s pool factory.
- `configure_s3_secrets` is not deleted (test depends on it).

## 8. Recommended nWave skills/agents (load-bearing 4)

1. **`nw-distill`** — author the failing acceptance + regression tests
   first. The Iron Rule + Outside-In TDD demand RED before GREEN.
2. **`nw-tdd-methodology`** — drives the RED_ACCEPTANCE → RED_UNIT →
   GREEN cadence inside `/nw-bugfix`.
3. **`nw-hexagonal-testing`** — keep the new test at the asyncpg port
   seam, not at internal mock points. This bug originated *because*
   the integration seam was untested; the regression must close that
   gap, not paper over it with mocks.
4. **`nw-test-design-mandates`** — discipline against tautologies,
   assertion-free "smoke" tests, and implementation-mirroring tests.
   The acceptance test must assert observable behaviour (rows returned,
   no 500), not internal SQL strings.

`nw-root-why` is *not* recommended: cause is fully diagnosed and the
RCA is captured in this document. `nw-progressive-refactoring` is
*not* recommended: the chosen option is small enough that L1–L6 passes
add ceremony without value. `nw-troubleshooter` may be reached for if
the integration test reveals an unexpected pg_duckdb interaction, but
it is not load-bearing for the planned change.

## 9. Notable trade-offs

- We are **not** moving credential ownership to the query-engine
  container (rejected Option A). This keeps app-side rotation cheap.
- We are **not** consolidating the lake-repo path with sql_access
  provisioning (rejected Option C). The two paths have different
  scoping (instance-wide admin vs project-scoped) and lifetimes; merging
  them would couple unrelated lifecycles.
- We accept a one-time SQL round-trip per process start. Acceptable.
- The unused `configure_s3_secrets` is left in place (with a
  re-export) rather than deleted, because removing exported public
  symbols touches `sql_access._infra/__init__.py`'s `__all__` and
  could surprise downstream callers. A separate cleanup bead can
  remove it later if confirmed dead.

## 10. Out of scope

- Refactor of the `lake/repository.py` boto3 client construction.
- Change to the SQL-access provisioning flow.
- Credential rotation tooling.
- Multi-tenant/per-project secrets (the bug is about the default secret;
  per-project secrets would be a separate design).
