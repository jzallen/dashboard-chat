## MODIFIED Requirements

### Requirement: Group role for DuckDB query authorization
The system SHALL create a PostgreSQL group role `duckdb_readers` (NOLOGIN) and configure the `duckdb.postgres_role` GUC to reference it. Individual per-project internal reader roles SHALL be granted membership in `duckdb_readers`. The group role and GUC SHALL be configured once at query engine startup via the init script, not during per-project provisioning.

#### Scenario: Query engine init script configures group role
- **WHEN** the query engine container starts and the init script runs
- **THEN** `duckdb_readers` role SHALL be created if it does not exist
- **AND** `ALTER SYSTEM SET duckdb.postgres_role = 'duckdb_readers'` SHALL be executed
- **AND** `pg_reload_conf()` SHALL be called to apply the GUC

#### Scenario: Init script is idempotent on restart
- **WHEN** the query engine container restarts and the init script runs again
- **THEN** the `duckdb_readers` role already exists and no error occurs
- **AND** the GUC is re-applied idempotently

#### Scenario: Internal reader role executes DuckDB query
- **WHEN** an external client connects as a proxy role, executes `SET ROLE reader_{short_id}`, and runs `SELECT * FROM view_name`
- **THEN** pg_duckdb SHALL allow the query because the internal reader is a member of the `duckdb.postgres_role` group

### Requirement: GUC setup integrated into query engine lifecycle
The `ensure_duckdb_role_configured()` function SHALL be called as part of the query engine init script at container startup, not during per-project provisioning. Per-project provisioning only grants `duckdb_readers` to the internal reader role.

#### Scenario: Provisioning flow order
- **WHEN** SQL access is enabled for a project
- **THEN** the system assumes `duckdb_readers` already exists (configured at engine startup)
- **AND** creates the internal reader role and grants `duckdb_readers` membership

### Requirement: Reader role grants use group role
The `create_project_schema()` function SHALL grant `duckdb_readers` to the internal reader role (`reader_{short_id}`). The proxy role (`proxy_{short_id}`) does NOT receive direct `duckdb_readers` membership — it accesses DuckDB capabilities via `SET ROLE` to the internal reader.

#### Scenario: Role membership after schema creation
- **WHEN** `create_project_schema()` creates an internal reader role
- **THEN** the SQL executed SHALL be `GRANT "duckdb_readers" TO "reader_{short_id}"`
- **AND** the proxy role receives only `SET ROLE reader_{short_id}` privilege, not direct `duckdb_readers` membership
