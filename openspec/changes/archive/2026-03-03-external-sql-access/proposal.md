## Why

Users configure datasets and transforms in the dashboard UI but need to analyze that data in external tools — Excel, Power BI, Tableau, and dbt CLI. Today the only way to get data out is a dbt project export targeting in-memory DuckDB, which requires technical setup and doesn't support live BI tool connections. Providing a standard PostgreSQL wire protocol endpoint lets any SQL-compatible tool connect directly, while the existing dbt project becomes dual-target (DuckDB for standalone, Postgres for live connectivity). Ephemeral per-project containers ensure resources are only consumed while SQL access is active, avoiding idle infrastructure costs.

## What Changes

- **New: per-project SQL access toggle** — users enable/disable external SQL connectivity from the project toolbar. Enabling launches an ephemeral pg_duckdb container for the project via a provisioner abstraction, creates a schema + read-only role, and returns dynamic connection details (host, port, database, username, password).
- **New: bootstrap pipeline** — dataset metadata is translated into a `bootstrap_db.sql` script containing `CREATE VIEW ... AS SELECT * FROM read_parquet('s3://...')` statements. This script, combined with `dbt run --target postgres`, defines the full queryable schema in pg_duckdb.
- **New: sync mechanism** — explicit "Sync" action regenerates the bootstrap script from current metadata and re-runs dbt, reflecting new datasets and updated transforms in external connections.
- **New: pg_duckdb provisioner abstraction** — ephemeral per-project pg_duckdb containers managed by a provisioner abstraction. `ProjectEnvironmentProvisioner` protocol defines the interface; `DockerPgDuckDbProvisioner` implements it for local dev using `aiodocker`, swappable for cloud container services in production. No static Docker Compose service.
- **Modified: dbt project generation** — the exported dbt project gains a `scripts/bootstrap_db.sql` file, a second `postgres` target in `profiles.yml`, and sources that resolve to bootstrap views (not S3 directly) when targeting Postgres. Staging/mart model SQL is unchanged.
- **New: credential management** — per-project PostgreSQL credentials (role + random password) are generated on enable, stored hashed in metadata, displayed once to the user, and revocable on disable.
- **New: connection details UI** — frontend panel showing host, port, database, username with copy-to-clipboard, active/inactive indicator, and sync button. Connection details are dynamic, derived from the provisioned container.

## Capabilities

### New Capabilities
- `external-sql-access`: Per-project SQL connectivity lifecycle — enable/disable toggle, ephemeral container provisioning via provisioner abstraction, credential provisioning and revocation, dynamic connection details display, sync mechanism, read-only enforcement, multi-tenant isolation via PostgreSQL schema-per-project, connection limits, environment lifecycle management, and error states (invalid credentials, connection limit reached, endpoint unavailable, environment startup failure).
- `dbt-bootstrap`: Bootstrap pipeline that bridges dataset metadata to pg_duckdb — generating `bootstrap_db.sql` with `read_parquet()` views from dataset storage paths, dual-target `profiles.yml` (DuckDB standalone + Postgres live), target-aware `sources.yml` resolution, dbt CLI execution from the backend to materialize views, and the self-contained exported project that engineers can run against their own pg_duckdb instance.

### Modified Capabilities
<!-- No existing specs in openspec/specs/ — all capabilities are new -->

## Impact

**Backend**
- New API endpoints: `POST/DELETE/GET /api/projects/{id}/sql-access`, `POST .../sync`, `POST .../credentials`
- New use cases: `enable_sql_access`, `disable_sql_access`, `sync_sql_access`
- New: `ProjectEnvironmentProvisioner` protocol + `DockerPgDuckDbProvisioner` implementation (manages ephemeral container lifecycle)
- Refactored: `pg_duckdb_manager` accepts `ProjectEnvironment` (host, port, environment_id) instead of static config
- New metadata table: `external_access` (project_id, pg_schema, pg_role, pg_password_hash, enabled, last_synced_at)
- Extended: `environment_id`, `environment_host`, `environment_port` columns on `external_access` table
- New Alembic migration for the `external_access` table
- New generator: `bootstrap_sql.py` alongside existing `model_sql.py` and `yaml_generators.py`
- Modified generator: `profiles_yml` gains postgres target; `sources_yml` gains target-aware source resolution
- New dependency: `dbt-core` + `dbt-postgres` (Python packages for programmatic dbt execution)
- New dependency: `aiodocker` (async Docker API client for container provisioning)
- New config: `pg_duckdb_image`, `pg_duckdb_network`, `environment_provisioner`

**Infrastructure**
- Removed: static `pg-duckdb` Docker Compose service. Added: Docker socket mount for API service. Containers managed programmatically by provisioner.
- Init script for S3 secret configuration (`duckdb.create_simple_secret()`) injected into ephemeral containers at startup
- Health check dependency on MinIO (pg_duckdb containers need S3 access)

**Frontend**
- New UI: connection details panel in project toolbar (host/port/db/username, copy button, active indicator, sync button)
- New API client methods for sql-access endpoints
- New query hooks for connection state

**Worker**
- No changes — chat/SSE streaming is unaffected

**Security**
- PostgreSQL roles enforce read-only access and schema isolation
- S3 credentials configured server-side in pg_duckdb init, never exposed to end users
- Per-role `CONNECTION LIMIT 3` caps resource usage
- Credential revocation on disable drops the role entirely
- Ephemeral containers are stopped and removed on disable, eliminating idle attack surface

**Dependencies**
- `pg_duckdb` v1.0+ (PostgreSQL extension, baked into container image)
- `aiodocker` (async Docker API client)
- `dbt-core` + `dbt-postgres` (Python packages)
- Existing: `MinIOLakeRepository` storage paths, dbt project generators, dataset metadata model
