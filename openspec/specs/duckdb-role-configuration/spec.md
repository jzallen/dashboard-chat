# duckdb-role-configuration Specification

## Purpose
TBD - created by archiving change sql-access-fixes. Update Purpose after archive.
## Requirements
### Requirement: Group role for DuckDB query authorization
The system SHALL create a PostgreSQL group role `duckdb_readers` (NOLOGIN) and configure the `duckdb.postgres_role` GUC to reference it. Individual per-project reader roles SHALL be granted membership in `duckdb_readers` instead of being granted the role directly.

#### Scenario: First project provisioned on a fresh container
- **WHEN** a pg_duckdb container is provisioned for the first time
- **THEN** `duckdb_readers` role SHALL be created if it does not exist
- **AND** `ALTER SYSTEM SET duckdb.postgres_role = 'duckdb_readers'` SHALL be executed
- **AND** `pg_reload_conf()` SHALL be called to apply the GUC

#### Scenario: Second project provisioned on the same container
- **WHEN** a second project is provisioned on a container where `duckdb_readers` already exists
- **THEN** the `ensure_duckdb_role_configured()` call SHALL be idempotent (no error)
- **AND** the reader role for the second project SHALL be granted membership in `duckdb_readers`

#### Scenario: Reader role executes DuckDB query
- **WHEN** an external client connects as a reader role and runs `SELECT * FROM view_name`
- **THEN** pg_duckdb SHALL allow the query because the reader is a member of the `duckdb.postgres_role` group

### Requirement: GUC setup integrated into provisioning lifecycle
The `ensure_duckdb_role_configured()` function SHALL be called during container provisioning, after the health check succeeds and before S3 secrets are configured.

#### Scenario: Provisioning flow order
- **WHEN** `docker_provisioner.provision()` completes the health check
- **THEN** `ensure_duckdb_role_configured(env)` SHALL be called before `configure_s3_secrets(env, storage_config)`

### Requirement: Reader role grants use group role
The `create_project_schema()` function SHALL grant `duckdb_readers` to the reader role instead of granting `duckdb.postgres_role` directly.

#### Scenario: Role membership after schema creation
- **WHEN** `create_project_schema()` creates a reader role
- **THEN** the SQL executed SHALL be `GRANT "duckdb_readers" TO "reader_XXXXXXXX"` (not `GRANT duckdb.postgres_role TO ...`)

