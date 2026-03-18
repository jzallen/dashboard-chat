# resilient-runtime-config Specification

## Purpose
TBD - created by archiving change sql-access-fixes. Update Purpose after archive.
## Requirements
### Requirement: S3 secrets are persistent across restarts
The `configure_s3_secrets()` function SHALL use `CREATE OR REPLACE PERSISTENT SECRET` (instead of `CREATE OR REPLACE SECRET`) so that S3/MinIO credentials survive pg_duckdb container restarts.

#### Scenario: Container restarts and secrets persist
- **WHEN** a pg_duckdb container is restarted (e.g., OOM kill, Docker restart policy)
- **THEN** `read_parquet('s3://...')` calls SHALL continue to work without re-running `configure_s3_secrets()`

#### Scenario: Secret SQL uses PERSISTENT keyword
- **WHEN** `configure_s3_secrets()` builds the DuckDB raw query
- **THEN** the SQL SHALL contain `CREATE OR REPLACE PERSISTENT SECRET minio_secret`

### Requirement: Internal MinIO endpoint for container networking
The system SHALL use a Docker-internal MinIO endpoint (e.g., `minio:9000`) when configuring S3 secrets inside pg_duckdb containers, instead of the external endpoint (`localhost:9000`).

#### Scenario: StorageConfig uses internal endpoint
- **WHEN** `enable_sql_access` or `sync_sql_access` builds a `StorageConfig`
- **THEN** the `endpoint` field SHALL use `settings.minio_internal_endpoint` when set, falling back to `settings.minio_endpoint` when empty

#### Scenario: New config setting exists
- **WHEN** the backend `Settings` class is loaded
- **THEN** a `minio_internal_endpoint` field SHALL exist with default value `""` (empty string)
- **AND** `docker-compose.yml` SHALL set `MINIO_INTERNAL_ENDPOINT=minio:9000` for the backend service

#### Scenario: Production S3 uses standard endpoint
- **WHEN** `minio_internal_endpoint` is not set (empty string)
- **THEN** the system SHALL fall back to `minio_endpoint` (no Docker-specific routing needed for real S3)

### Requirement: Connection limit is configurable and sufficient
The reader role connection limit SHALL be configurable via `pg_duckdb_connection_limit` setting (default: 10) instead of hard-coded to 3.

#### Scenario: Default connection limit is 10
- **WHEN** a reader role is created with default settings
- **THEN** `CONNECTION LIMIT 10` SHALL be used in the `CREATE ROLE` statement

#### Scenario: Custom connection limit via config
- **WHEN** `PG_DUCKDB_CONNECTION_LIMIT=20` is set in the environment
- **THEN** reader roles SHALL be created with `CONNECTION LIMIT 20`

### Requirement: Idle session timeout auto-cleans stale connections
Reader roles SHALL have `idle_session_timeout` set to 5 minutes to automatically disconnect idle ODBC clients and free connection slots.

#### Scenario: Idle timeout configured on role creation
- **WHEN** `create_project_schema()` creates a reader role
- **THEN** `ALTER ROLE "reader_XXXXXXXX" SET idle_session_timeout = '5min'` SHALL be executed

### Requirement: Reconciliation re-applies runtime config
The `reconcile_sql_access` use case SHALL re-apply `duckdb.postgres_role` GUC and S3 secrets for healthy environments during startup reconciliation.

#### Scenario: Healthy container gets runtime config re-applied
- **WHEN** reconciliation finds a healthy (running) environment
- **THEN** `ensure_duckdb_role_configured(env)` and `configure_s3_secrets(env, storage_config)` SHALL be called
- **AND** failures in re-applying config SHALL be logged as warnings (not fatal)

#### Scenario: Degraded container is skipped
- **WHEN** reconciliation finds a degraded (not running) environment
- **THEN** no runtime config re-application SHALL be attempted (only logged as degraded)

