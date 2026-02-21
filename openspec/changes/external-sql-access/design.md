## Context

Dashboard Chat stores dataset data as hive-partitioned Parquet in MinIO/S3 and queries it via DuckDB + Ibis for in-browser table previews. An existing dbt export feature (`export_dbt_project.py`) generates a self-contained dbt project targeting in-memory DuckDB, with staging models that apply the user's transforms (clean → filter → alias) as CTE pipelines.

Users need to connect external tools (Excel/ODBC, Power BI, Tableau, dbt CLI) to query the same data. These tools speak SQL over a wire protocol — they can't consume Parquet from S3 directly.

The approach: add a shared PostgreSQL instance with the `pg_duckdb` extension as a **protocol adapter**. pg_duckdb embeds DuckDB's analytical engine inside Postgres, allowing `read_parquet('s3://...')` from standard SQL. The existing dbt project becomes dual-target — same staging models, different source resolution per target.

### Current State

**Data flow (unchanged by this change):**
```
CSV upload → Parquet in S3 → DuckDB/Ibis queries → JSON preview rows → Frontend
```

**Existing dbt generators** (`backend/app/use_cases/project/dbt/`):
- `profiles_yml.py` — DuckDB target with S3 env_var placeholders
- `sources_yml.py` — Maps datasets to S3 paths via `external_location` meta
- `model_sql.py` — CTE pipeline per dataset: `source → cleaned → filtered → SELECT aliases`
- `macros_sql.py` — DuckDB UDFs: `title_case()`, `snake_case()`, `kebab_case()`
- `schema_yml.py`, `project_yml.py`, `readme.py`, `naming.py`
- `__init__.py` — Orchestrator: `generate_dbt_project_zip(project, name_snake)`

**Key reuse points:**
- `Dataset.storage_path` → `datasets/{project_id}/{dataset_id}/` (S3 prefix for Parquet)
- `MinIOLakeRepository._configure_duckdb_s3()` → S3 connection params from `Settings`
- `generate_sources_yml(project_name_snake, datasets)` → dataset-to-source mapping
- `generate_model_sql(dataset, source_name, project_name)` → transform CTE pipeline

## Goals / Non-Goals

**Goals:**
- External tools connect via standard PostgreSQL wire protocol and query datasets with SQL
- Transforms (filter, clean, alias) applied in the dashboard are reflected in external query results
- Per-project isolation — credentials for Project A cannot access Project B's data
- The exported dbt project is self-contained: an engineer can `psql -f bootstrap_db.sql` + `dbt run --target postgres` against their own pg_duckdb instance
- Read-only access — no mutations through the external connection
- Web UI data path (DuckDB + Ibis) is completely unchanged

**Non-Goals:**
- Write-back from external tools to dashboard datasets
- Auto-sync on every dataset mutation (Phase 2 — manual "Sync" for now)
- Instance-per-project isolation (shared instance with schema isolation is sufficient at current scale)
- Production-grade HA / connection pooling (PgBouncer, RDS) — this is the local/staging architecture
- Real-time streaming of changes to connected BI tools

## Decisions

### D1: dbt project as the schema definition layer

The dbt project — not raw DDL — defines what's queryable in Postgres. The bootstrap script creates source views, dbt models create staging/mart views on top.

```
Dataset metadata
      ↓
  bootstrap_db.sql          CREATE VIEW src AS SELECT * FROM read_parquet('s3://...')
      ↓
  dbt sources.yml           Declares bootstrap views as dbt sources
      ↓
  dbt staging models        CTE pipeline: source → cleaned → filtered → aliases
      ↓
  dbt run --target postgres
      ↓
  Queryable views in pg_duckdb
```

**Why not raw DDL (CREATE VIEW with full transform SQL)?**
- The staging model SQL already exists and is tested — `model_sql.py` generates correct CTE pipelines for all transform combinations
- dbt manages schema lifecycle (create, replace, drop) — no custom DDL state tracking
- The same project works for both DuckDB (standalone analysis) and Postgres (live connectivity)
- Future upgrade to RDS: swap `read_parquet()` views for tables, change materialization — models unchanged

**Alternative: generate Postgres views directly from `Dataset.staging_sql`.**
Rejected because `staging_sql` is Ibis-generated with hardcoded S3 paths — it works for one-shot preview queries but doesn't compose with dbt's source abstraction, materialization control, or project portability.

### D2: Shared pg_duckdb instance with schema-per-project

One PostgreSQL 16 + pg_duckdb instance. Each project that enables SQL access gets:
- `CREATE SCHEMA project_{short_id}` — namespace isolation
- `CREATE ROLE reader_{short_id} LOGIN PASSWORD '...' IN ROLE pg_read_all_data` — scoped to schema via `SET search_path`
- `ALTER ROLE reader_{short_id} CONNECTION LIMIT 3` — resource cap

**Why not instance-per-project?**
- Avoids container orchestration (Docker-in-Docker, pool management, or a scheduler)
- One health check, one set of S3 secrets, one Docker Compose service
- pg_duckdb gives each connection its own DuckDB engine instance, so queries don't contend
- Schema + role isolation is the standard PostgreSQL multi-tenancy pattern

**When to revisit:** If memory pressure from concurrent DuckDB engines becomes an issue (each connection allocates ~256MB), move to instance-per-org with a provisioner service.

### D3: Dual-target dbt profiles with target-aware sources

The exported dbt project gains a second target in `profiles.yml`:

```yaml
project_name:
  target: dev
  outputs:
    dev:                              # Existing: standalone DuckDB
      type: duckdb
      path: ":memory:"
      extensions: [httpfs]
      settings:
        s3_access_key_id: "{{ env_var('S3_ACCESS_KEY_ID') }}"
        s3_secret_access_key: "{{ env_var('S3_SECRET_ACCESS_KEY') }}"
        s3_endpoint: "{{ env_var('S3_ENDPOINT', '') }}"
        s3_url_style: "{{ env_var('S3_URL_STYLE', 'vhost') }}"
        s3_region: "{{ env_var('S3_REGION', 'us-east-1') }}"
    postgres:                         # New: live pg_duckdb connection
      type: postgres
      host: "{{ env_var('PG_HOST', 'localhost') }}"
      port: "{{ env_var('PG_PORT', '5433') }}"
      user: "{{ env_var('PG_USER') }}"
      password: "{{ env_var('PG_PASSWORD') }}"
      dbname: "{{ env_var('PG_DATABASE', 'dashboard_external') }}"
      schema: "{{ env_var('PG_SCHEMA', 'public') }}"
```

**Sources resolution** depends on target:
- **DuckDB target** (existing): `external_location` meta on source tables → DuckDB reads Parquet directly from S3
- **Postgres target** (new): no `external_location` — sources resolve to bootstrap views already created by `bootstrap_db.sql`

Since `external_location` is a dbt-duckdb-specific feature that Postgres ignores, the same `sources.yml` works for both targets without conditional logic. The DuckDB adapter reads `external_location`; the Postgres adapter ignores it and resolves to the view name.

**Staging models are identical for both targets.** The `{{ source('project', 'dataset') }}` macro resolves differently per adapter, but the CTE pipeline SQL is the same. DuckDB functions used in transforms (`TRIM`, `UPPER`, `COALESCE`, `CASE`) work in pg_duckdb because it routes queries through DuckDB's engine.

### D4: Bootstrap SQL generator alongside existing generators

New file: `backend/app/use_cases/project/dbt/bootstrap_sql.py`

```python
def generate_bootstrap_sql(
    schema_name: str,
    datasets: list[tuple[str, Dataset]],
    bucket: str,
) -> str:
```

Generates:
```sql
CREATE SCHEMA IF NOT EXISTS {schema_name};

CREATE OR REPLACE VIEW {schema_name}.{dataset_snake} AS
  SELECT * FROM read_parquet('s3://{bucket}/{dataset.storage_path}**/*.parquet');
-- repeated per dataset
```

This reuses `Dataset.storage_path` (already computed as `datasets/{project_id}/{dataset_id}/`) and `to_snake_case()` from `naming.py`.

The bootstrap script is included in the exported ZIP at `scripts/bootstrap_db.sql` and also executed by the backend when enabling/syncing SQL access.

### D5: dbt-core Python API for backend execution

When a user enables or syncs SQL access, the backend must run `dbt run --target postgres`. Options:

| Approach | Pros | Cons |
|----------|------|------|
| **dbt-core Python API** | No subprocess, same process, programmatic error handling | API less stable across dbt versions |
| **subprocess** (`dbt run`) | Simple, well-documented CLI | Requires dbt CLI in container, stdout parsing |
| **Sidecar service** | Decoupled, async | New service, IPC complexity |

**Decision: subprocess with `dbt run`.**

Rationale: dbt-core's Python API (`dbt.cli.main`) is not a stable public interface — it changes between minor versions. The CLI is the supported contract. The backend writes the dbt project to a temp directory, runs `dbt run --target postgres --project-dir /tmp/...`, and captures exit code + output. This also means `dbt-core` and `dbt-postgres` are CLI dependencies of the backend container, not Python library dependencies.

**Execution flow:**
1. Generate dbt project files to temp dir (reuse existing generators + new bootstrap)
2. Execute `psql -f scripts/bootstrap_db.sql` against pg_duckdb (creates source views)
3. Execute `dbt run --target postgres --project-dir {tmpdir} --profiles-dir {tmpdir}` (creates staging views)
4. Capture success/failure, store `last_synced_at`
5. Clean up temp dir

### D6: Manual sync with explicit user action

"Sync" is a button click, not automatic. When clicked:
1. Regenerate bootstrap SQL from current dataset metadata
2. Re-run bootstrap + dbt against pg_duckdb
3. New datasets appear, removed datasets' views are dropped, updated transforms rebuild

**Why not auto-sync?**
- Avoids surprise schema changes for connected BI tools mid-session
- Simpler implementation — no event consumer, no background worker
- The outbox already captures `DatasetUpdated` events, so auto-sync is a clean Phase 2 addition

**Sync semantics:** `CREATE OR REPLACE VIEW` is idempotent for updates. For removals, the sync drops all views in the schema and recreates from scratch (dataset count is small enough that this is instant).

### D7: Credential lifecycle

**On enable:**
1. Generate `short_id` = first 8 chars of project UUID (collision-safe within a single instance)
2. `CREATE ROLE reader_{short_id} LOGIN PASSWORD '{random_32_char}' CONNECTION LIMIT 3`
3. `GRANT USAGE ON SCHEMA project_{short_id} TO reader_{short_id}`
4. `ALTER ROLE reader_{short_id} SET search_path TO project_{short_id}`
5. Store `ExternalAccess(project_id, pg_schema, pg_role, bcrypt(password), enabled=True)` in metadata DB
6. Return plaintext password + connection details to frontend (one-time display)

**On disable:**
1. `DROP SCHEMA project_{short_id} CASCADE` (removes all views)
2. `DROP ROLE reader_{short_id}`
3. Update `ExternalAccess.enabled = False` in metadata DB

**On regenerate credentials:**
1. `ALTER ROLE reader_{short_id} PASSWORD '{new_random}'`
2. Update hash in metadata DB
3. Return new plaintext password (one-time display)

Passwords are never stored in plaintext server-side. The frontend displays them once on create/regenerate with a copy button and a warning.

## Risks / Trade-offs

**[pg_duckdb maturity]** → pg_duckdb v1.0 is recent. S3 secret management and `read_parquet()` in views may have edge cases.
*Mitigation:* Pin to a tested version. Bootstrap SQL is simple (one function call per view). Add integration tests that verify round-trip: bootstrap → dbt run → SELECT.

**[Memory per connection]** → Each pg_duckdb connection spawns a DuckDB engine instance (~256MB baseline).
*Mitigation:* `CONNECTION LIMIT 3` per role caps at ~768MB per project. Shared instance with 4-5 active projects stays under 4GB. Monitor with `pg_stat_activity`.

**[DuckDB macro compatibility in pg_duckdb]** → Custom macros (`title_case`, `snake_case`, `kebab_case`) are created via `CREATE MACRO` which is DuckDB syntax. pg_duckdb may require these to be registered via `duckdb.raw_query()`.
*Mitigation:* Test macro registration during bootstrap. If needed, create a `register_macros.sql` that uses pg_duckdb's API. These macros are only used if datasets have case-transform cleaning steps — most datasets won't need them.

**[Bootstrap SQL has hardcoded S3 paths]** → `read_parquet('s3://bucket/datasets/...')` bakes the bucket name into views.
*Mitigation:* Acceptable for same-instance use (bucket is known). For exported projects, the bootstrap script parameterizes the bucket. For the live instance, the backend generates with the actual bucket from `Settings.storage_bucket`.

**[Sync drops and recreates all views]** → During sync, there's a brief window where views don't exist.
*Mitigation:* Wrap in a transaction (`BEGIN; DROP...; CREATE...; COMMIT;`). Connected tools see either the old or new schema, never empty.

**[dbt CLI as a runtime dependency]** → Backend container needs `dbt-core` + `dbt-postgres` + `dbt-duckdb` installed.
*Mitigation:* Add to backend `pyproject.toml` dev dependencies. Production builds include them. The CLI is invoked via `subprocess` so version pinning is straightforward.

## Migration Plan

**Phase 1 — Infrastructure + Bootstrap (can be merged independently):**
1. Add `pg-duckdb` service to `docker-compose.yml` (with init script for S3 secrets)
2. Add `bootstrap_sql.py` generator
3. Add postgres target to `profiles_yml.py` generator
4. Add `ExternalAccess` model + Alembic migration
5. Verify: bootstrap SQL + dbt run produces queryable views

**Phase 2 — Backend API + Execution:**
1. Add `enable_sql_access`, `disable_sql_access`, `sync_sql_access` use cases
2. Add router endpoints under `/api/projects/{id}/sql-access`
3. Add credential generation + storage logic
4. Integration test: enable → connect via psql → query → disable → verify dropped

**Phase 3 — Frontend UI:**
1. Connection details panel component
2. Enable/disable toggle in project toolbar
3. Copy-to-clipboard for connection string
4. Sync button with loading state
5. Active/inactive status indicator

**Phase 4 — dbt Export Integration:**
1. Include `scripts/bootstrap_db.sql` in exported ZIP
2. Update README with Postgres setup instructions
3. Verify exported project runs against external pg_duckdb

**Rollback:** Disable feature flag → `DROP SCHEMA CASCADE` for all active projects → remove `pg-duckdb` service. Metadata table can remain (soft delete). No other services are affected.

## Open Questions

1. **pg_duckdb Docker image** — Is `pgduckdb/pgduckdb:16-v1.0` the right base image, or do we need a custom build with httpfs pre-installed? Needs validation.

2. **S3 secret registration timing** — `duckdb.create_simple_secret()` must run before any `read_parquet()` call. Does this persist across connections, or must it run per-connection? If per-connection, the bootstrap script needs to include it.

3. **dbt-duckdb `external_location` behavior in Postgres adapter** — We assume the Postgres adapter ignores the `external_location` meta key in `sources.yml`. Need to verify this doesn't cause a dbt compilation error.

4. **Connection string format** — What format do users need for Excel ODBC vs Power BI vs Tableau? Should we show adapter-specific connection strings or a generic `postgresql://` URI?

5. **Feature gating** — Should SQL access be behind a feature flag or available to all projects? If gated, where is the flag checked (frontend only, or backend enforced)?
