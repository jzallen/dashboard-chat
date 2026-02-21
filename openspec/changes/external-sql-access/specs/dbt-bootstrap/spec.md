## ADDED Requirements

### Requirement: Bootstrap SQL generation from dataset metadata
The system SHALL generate a `bootstrap_db.sql` script that creates one PostgreSQL view per dataset using `read_parquet()` to read from the dataset's S3 Parquet path. Views SHALL be created in a project-specific schema. The generator SHALL reuse `Dataset.storage_path` and `to_snake_case()` from existing dbt naming utilities.

#### Scenario: Generate bootstrap SQL for a project with multiple datasets
- **WHEN** a project has datasets "Sales Data" (storage_path `datasets/proj-1/ds-1/`) and "Customer List" (storage_path `datasets/proj-1/ds-2/`)
- **AND** the storage bucket is `dashboard-chat.datalake`
- **THEN** the generated SQL contains:
  - `CREATE SCHEMA IF NOT EXISTS project_{short_id};`
  - `CREATE OR REPLACE VIEW project_{short_id}.sales_data AS SELECT * FROM read_parquet('s3://dashboard-chat.datalake/datasets/proj-1/ds-1/**/*.parquet');`
  - `CREATE OR REPLACE VIEW project_{short_id}.customer_list AS SELECT * FROM read_parquet('s3://dashboard-chat.datalake/datasets/proj-1/ds-2/**/*.parquet');`

#### Scenario: Dataset names are deduplicated
- **WHEN** a project has datasets with names that collide after snake_case conversion (e.g., "My Data" and "my-data")
- **THEN** the generator applies suffix deduplication (e.g., `my_data`, `my_data_2`) consistent with existing dbt naming logic

#### Scenario: Bootstrap SQL uses CREATE OR REPLACE
- **WHEN** bootstrap SQL is regenerated during a sync
- **THEN** all views use `CREATE OR REPLACE VIEW` so existing views are updated in place
- **AND** no manual DROP is required for updated datasets

### Requirement: Bootstrap SQL includes schema cleanup for removed datasets
The system SHALL ensure that views for deleted datasets are removed during sync. The bootstrap pipeline SHALL drop all existing views in the schema before recreating from current metadata, wrapped in a transaction.

#### Scenario: Sync removes deleted dataset views
- **WHEN** a project previously had 3 datasets with SQL access enabled
- **AND** one dataset is deleted in the web UI
- **AND** the user syncs SQL access
- **THEN** the bootstrap pipeline drops all views in the project schema
- **AND** recreates only the 2 remaining datasets as views
- **AND** the operation is atomic (wrapped in a transaction)

### Requirement: Dual-target dbt profiles generation
The dbt project generator SHALL produce a `profiles.yml` with two targets: `dev` (existing DuckDB target for standalone use) and `postgres` (new target for pg_duckdb connectivity). Both targets SHALL use environment variable placeholders for credentials.

#### Scenario: Profiles.yml includes both targets
- **WHEN** a dbt project is generated for export
- **THEN** `profiles.yml` contains a `dev` output with `type: duckdb` and S3 env_var settings (existing behavior)
- **AND** `profiles.yml` contains a `postgres` output with `type: postgres` and env_var placeholders for PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, PG_SCHEMA
- **AND** the default target remains `dev` (existing behavior unchanged)

#### Scenario: Existing DuckDB target is unchanged
- **WHEN** a dbt project is generated
- **THEN** the `dev` target is identical to the current output of `generate_profiles_yml()`
- **AND** existing DuckDB-only workflows are not affected

### Requirement: Sources resolve correctly per target
The dbt `sources.yml` SHALL work for both targets. The DuckDB adapter reads the `external_location` meta key to resolve Parquet paths directly. The Postgres adapter ignores `external_location` and resolves source references to the bootstrap views created by `bootstrap_db.sql`.

#### Scenario: DuckDB target uses external_location
- **WHEN** `dbt run --target dev` is executed
- **THEN** dbt-duckdb reads `external_location` from source table meta
- **AND** queries Parquet files directly from S3

#### Scenario: Postgres target uses bootstrap views
- **WHEN** `bootstrap_db.sql` has been executed against pg_duckdb
- **AND** `dbt run --target postgres` is executed
- **THEN** dbt-postgres ignores `external_location` meta
- **AND** `{{ source('project', 'dataset') }}` resolves to the bootstrap view name
- **AND** staging models query the bootstrap views (which read Parquet via `read_parquet()`)

#### Scenario: Staging model SQL is target-agnostic
- **WHEN** staging models are generated with transform CTE pipelines
- **THEN** the SQL is identical for both targets
- **AND** DuckDB functions (TRIM, UPPER, COALESCE, CASE) work in pg_duckdb because it routes queries through DuckDB's engine

### Requirement: Bootstrap script included in dbt export
The exported dbt project ZIP SHALL include `scripts/bootstrap_db.sql` when the project has datasets. The README SHALL be updated with Postgres setup instructions.

#### Scenario: Export includes bootstrap script
- **WHEN** the user exports a dbt project
- **THEN** the ZIP contains `scripts/bootstrap_db.sql` with `CREATE VIEW` statements for all datasets
- **AND** the bootstrap script uses a parameterized bucket name (via a comment or variable) for portability

#### Scenario: Export README includes Postgres instructions
- **WHEN** the user exports a dbt project
- **THEN** the README includes instructions for:
  - Running `bootstrap_db.sql` against a pg_duckdb instance
  - Configuring S3 secrets in pg_duckdb
  - Running `dbt run --target postgres`

### Requirement: dbt execution from backend
The system SHALL execute `bootstrap_db.sql` via `psql` and `dbt run --target postgres` via subprocess when enabling or syncing SQL access. The backend container SHALL have `dbt-core`, `dbt-postgres`, and `psql` available as CLI tools.

#### Scenario: Enable triggers bootstrap + dbt run
- **WHEN** SQL access is enabled for a project
- **THEN** the system generates the dbt project files to a temp directory
- **AND** executes `psql -f scripts/bootstrap_db.sql` against the pg_duckdb instance
- **AND** executes `dbt run --target postgres --project-dir {tmpdir} --profiles-dir {tmpdir}`
- **AND** cleans up the temp directory after completion

#### Scenario: Sync re-executes bootstrap + dbt run
- **WHEN** the user syncs SQL access
- **THEN** the system regenerates the dbt project from current metadata
- **AND** re-executes `psql` + `dbt run` to update all views

#### Scenario: Bootstrap or dbt failure is reported
- **WHEN** `psql` or `dbt run` exits with a non-zero code
- **THEN** the system captures stderr output
- **AND** returns an error to the user indicating the sync/enable failed
- **AND** no partial state is left (previous views remain if sync failed)

### Requirement: Custom DuckDB macros work in pg_duckdb
The dbt project's custom macros (`title_case`, `snake_case`, `kebab_case`) SHALL be registered in pg_duckdb so staging models using case-transform cleaning steps execute correctly.

#### Scenario: Macros registered during bootstrap
- **WHEN** the bootstrap pipeline runs against pg_duckdb
- **THEN** DuckDB macros are registered (via `dbt run` on-run-start hook or bootstrap script)
- **AND** staging models referencing `title_case()`, `snake_case()`, or `kebab_case()` execute correctly

### Requirement: Self-contained exported dbt project
An engineer receiving the exported dbt project SHALL be able to run it against their own pg_duckdb instance without any dependency on the dashboard-chat application.

#### Scenario: Standalone execution with DuckDB (existing)
- **WHEN** an engineer sets S3 environment variables
- **AND** runs `dbt run` (default target)
- **THEN** dbt connects to in-memory DuckDB, reads Parquet from S3, and materializes all models

#### Scenario: Standalone execution with pg_duckdb (new)
- **WHEN** an engineer has a pg_duckdb instance with S3 secrets configured
- **AND** runs `psql -f scripts/bootstrap_db.sql` against that instance
- **AND** sets PG_HOST, PG_PORT, PG_USER, PG_PASSWORD environment variables
- **AND** runs `dbt run --target postgres`
- **THEN** dbt connects to Postgres, finds bootstrap views, and materializes all staging/mart models as views

#### Scenario: Upgrade path to persistent database
- **WHEN** an engineer wants to move from pg_duckdb to a persistent RDS
- **THEN** they can replace `read_parquet()` views in bootstrap script with `CREATE TABLE` + data load
- **AND** change dbt materializations from `view` to `table`/`incremental`
- **AND** the staging/mart model SQL requires no changes

### Requirement: pg_duckdb infrastructure service
The system SHALL include a pg_duckdb Docker Compose service (PostgreSQL 16+ with pg_duckdb extension) that starts alongside existing services. S3 credentials SHALL be configured via an init script so `read_parquet()` can access MinIO/S3.

#### Scenario: Service starts with Docker Compose
- **WHEN** `docker compose up` is run
- **THEN** the pg_duckdb service starts on port 5433
- **AND** the service passes its health check
- **AND** `read_parquet('s3://dashboard-chat.datalake/...')` queries succeed from within the instance

#### Scenario: S3 secrets configured on init
- **WHEN** the pg_duckdb container starts for the first time
- **THEN** an init script configures DuckDB S3 secrets using `duckdb.create_simple_secret()` or equivalent
- **AND** credentials match the MinIO/S3 configuration from the backend's `Settings`

#### Scenario: Service depends on MinIO
- **WHEN** the pg_duckdb service starts
- **THEN** it waits for MinIO to be healthy before accepting connections
- **AND** `read_parquet()` calls resolve S3 paths correctly
