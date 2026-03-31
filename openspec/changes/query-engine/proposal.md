## Why

DuckDB runs in-process inside the FastAPI web server. Every dataset preview, row count, and cleaning operation spins up an embedded DuckDB connection that shares memory and CPU with HTTP request handling. A heavy analytical query can starve the API; an OOM or DuckDB crash takes the entire server process down. The hand-rolled SQL validation in `sql_safety.py` is the only barrier between user-provided filter expressions and arbitrary code execution in the server process — if bypassed, it's not just SQL injection, it's RCE.

Meanwhile, the external SQL access feature already provisions ephemeral per-project pg_duckdb containers via `DockerPgDuckDbProvisioner`. This is the right idea (DuckDB behind a PostgreSQL wire protocol boundary) but the wrong topology for a single-tenant internal platform: spinning up and tearing down containers per project adds operational complexity that isn't justified when tenant isolation is user/project-level, not org-level.

A single always-on query engine container — PostgreSQL + pg_duckdb — solves both problems. The backend delegates all analytical queries over the network to a process-isolated, resource-bounded service. BI tools connect via standard ODBC/JDBC with dedicated read-only users. PostgreSQL roles, `statement_timeout`, and `CONNECTION LIMIT` replace hand-rolled safety logic as the primary enforcement boundary. The architecture matches how MinIO already serves as a dedicated object store in the stack.

## What Changes

- **New: always-on query engine service** — a single `query-engine` container (PostgreSQL + pg_duckdb + httpfs) in docker-compose, alongside minio and redis. Configured with S3/MinIO credentials at startup. Per-project schemas and read-only roles created on demand.

- **Replaced: in-process DuckDB** — all backend paths that currently use `ibis.duckdb.connect()` via `duckdb_factory.py` are replaced with asyncpg queries against the query engine. This covers dataset preview (`dataset.py._build_table`), row counts, column type inspection, cleaning operation previews, and CSV-to-parquet conversion in `lake/repository.py`.

- **Simplified: provisioner infrastructure** — the `DockerPgDuckDbProvisioner` (aiodocker, per-project containers, dynamic port mapping, health polling) is replaced with a stateless provisioner that creates/drops schemas and roles in the shared query engine instance. The `ProjectEnvironmentProvisioner` protocol simplifies to schema lifecycle management. Connection info comes from config, not runtime container inspection.

- **Simplified: PgBouncer** — a single optional PgBouncer instance in front of the shared query engine replaces per-project PgBouncer containers. At internal-platform scale, this may be unnecessary entirely.

- **Retained: pg_duckdb_manager.py** — schema/role/credential management already operates against a connection target via asyncpg. It works as-is against a shared instance. Per-project schemas (`project_{short_id}`), read-only roles (`reader_{short_id}`), `idle_session_timeout`, `CONNECTION LIMIT`, and `search_path` lockdown are all retained.

- **Retained: sql_safety.py** — AST-based SQL validation remains as defense-in-depth. PostgreSQL roles become the primary enforcement boundary; validation becomes a second layer.

- **Retained: bootstrap_sql.py** — view creation per project (`CREATE VIEW ... AS SELECT * FROM read_parquet('s3://...')`) is unchanged. Views are created in the query engine instead of ephemeral containers.

- **Removed: duckdb_factory.py** — the in-process hardened connection factory is no longer needed. The query engine container handles extension loading, S3 configuration, and security lockdown at startup.

- **Removed: aiodocker dependency** — no longer managing container lifecycle from the backend.

## Capabilities

### New Capabilities
- `query-engine`: Always-on analytical query sandbox — a PostgreSQL + pg_duckdb container that serves as the dedicated query execution layer for both the backend API and external BI tools. Connects to S3/MinIO for parquet access. Exposes standard PostgreSQL wire protocol. Resource-isolated from the web server. Per-project schema isolation with read-only roles. Configurable resource limits (memory, CPU, statement timeout) at the container and role level.

### Modified Capabilities
- `external-sql-access`: Simplified from ephemeral per-project container provisioning to schema/role lifecycle management against a shared query engine instance. Enable/disable creates or drops a schema and role rather than starting or stopping a container. Connection details point to the shared query engine (fixed host/port) rather than dynamically assigned ports.
- `dbt-bootstrap`: Bootstrap SQL executes against the shared query engine instead of ephemeral containers. No changes to SQL generation — only the execution target changes.
- `duckdb-role-configuration`: The `duckdb_readers` group role and `duckdb.postgres_role` GUC are configured once at query engine startup rather than per-container provision.

## Impact

**Backend**
- Removed: `app/utils/duckdb_factory.py` (in-process DuckDB factory)
- Removed: `app/use_cases/sql_access/_infra/docker_provisioner.py` (per-project container lifecycle)
- Removed: `app/use_cases/sql_access/_infra/pgbouncer_provisioner.py` (per-project PgBouncer)
- Simplified: `app/use_cases/sql_access/_infra/provisioner.py` (protocol reduces to schema/role management)
- Modified: `app/models/dataset.py` — `_get_connection()` and `_build_table()` switch from `ibis.duckdb.connect()` to asyncpg queries against the query engine
- Modified: `app/repositories/lake/repository.py` — `_create_s3_connection()`, `read_parquet_preview()`, `get_parquet_row_count()`, `get_parquet_column_type()`, `preview_cleaning_operation()` all switch to query engine
- Modified: `app/repositories/lake/repository.py` — `write_csv_as_partitioned_parquet()` uses query engine for CSV conversion (or retained as local-only operation)
- Modified: `app/config.py` — replace per-container pg_duckdb settings with shared query engine connection config (host, port, admin credentials)
- Modified: `app/main.py` — provisioner startup simplified; no aiodocker initialization
- Modified: `app/use_cases/sql_access/enable_sql_access.py`, `start_environment.py`, `stop_environment.py` — simplified to schema/role operations
- Removed dependency: `aiodocker`
- Removed dependency: `ibis-framework[duckdb]` (or reduced to non-DuckDB usage if Ibis is used elsewhere)

**Infrastructure**
- New: `query-engine` service in docker-compose (pgduckdb/pgduckdb image, always-on, `pull_policy: never` if Bazel-built)
- New: init script for query engine startup (load httpfs, configure S3 secrets, create `duckdb_readers` group role, set GUC)
- Optional: single PgBouncer service in front of query engine (replaces per-project PgBouncer containers)
- Modified: backend service no longer needs Docker socket mount (no container provisioning)
- Resource limits: `mem_limit`, `cpus` on query engine container; `statement_timeout` and `CONNECTION LIMIT` per role

**Frontend**
- No changes — connection details UI already shows host/port/username. Values become static (shared query engine) rather than dynamic (per-container).

**Worker**
- No changes

**Security**
- PostgreSQL roles become the primary access control boundary (not hand-rolled SQL validation)
- `sql_safety.py` validation retained as defense-in-depth
- Query engine container runs with no access to backend secrets, database credentials, or filesystem
- `statement_timeout` per role prevents runaway queries (not possible with in-process DuckDB today)
- Container-level memory limits prevent OOM from affecting the API server
- Docker socket no longer exposed to the backend service (reduced attack surface)
