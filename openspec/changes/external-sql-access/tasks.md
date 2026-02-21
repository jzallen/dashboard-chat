## 1. Infrastructure: pg_duckdb Docker Service

- [ ] 1.1 Create `backend/scripts/pg_duckdb_init.sql` init script that configures S3 secrets via `duckdb.create_simple_secret()` using MinIO credentials (endpoint, access key, secret key, url_style=path)
- [ ] 1.2 Add `pg-duckdb` service to `docker-compose.yml` — PostgreSQL 16 + pg_duckdb extension on port 5433, with healthcheck, `depends_on: minio` (service_healthy), and volume mount for init script
- [ ] 1.3 Validate pg_duckdb image: verify `pgduckdb/pgduckdb:16-v1.0` (or latest stable) includes httpfs and can execute `SELECT * FROM read_parquet('s3://dashboard-chat.datalake/...')` after init
- [ ] 1.4 Add pg_duckdb connection settings to `backend/app/config.py`: `pg_duckdb_host`, `pg_duckdb_port`, `pg_duckdb_admin_user`, `pg_duckdb_admin_password`, `pg_duckdb_database`, `pg_duckdb_external_host`, `pg_duckdb_external_port`
- [ ] 1.5 Add corresponding environment variables to the `api` and `api-full` services in `docker-compose.yml`

## 2. Data Model: ExternalAccess Metadata

- [ ] 2.1 Create `ExternalAccessRecord` SQLAlchemy model in `backend/app/models/` with fields: id (UUID), project_id (FK, unique), org_id, pg_schema, pg_role, pg_password_hash, enabled (bool), last_synced_at, created_at, updated_at
- [ ] 2.2 Create Alembic migration for the `external_access` table with unique constraint on project_id
- [ ] 2.3 Add `ExternalAccessRepository` to `backend/app/repositories/` with CRUD operations: create, get_by_project_id, update, and soft-disable (set enabled=False)
- [ ] 2.4 Register `ExternalAccessRepository` in the `RepositoryContainer` in the `with_repositories` decorator

## 3. Bootstrap SQL Generator

- [ ] 3.1 Create `backend/app/use_cases/project/dbt/bootstrap_sql.py` with `generate_bootstrap_sql(schema_name, datasets, bucket)` — generates `CREATE SCHEMA IF NOT EXISTS` + `CREATE OR REPLACE VIEW ... AS SELECT * FROM read_parquet('s3://...')` per dataset
- [ ] 3.2 Add cleanup preamble to bootstrap SQL: drop all existing views in the schema before recreating (within a transaction), to handle deleted datasets on sync
- [ ] 3.3 Write unit tests for `generate_bootstrap_sql()`: multiple datasets, snake_case deduplication, empty dataset list, special characters in names
- [ ] 3.4 Verify generated SQL uses `Dataset.storage_path` and `to_snake_case()`/`deduplicate_names()` from existing `naming.py`

## 4. Dual-Target dbt Profiles

- [ ] 4.1 Modify `backend/app/use_cases/project/dbt/profiles_yml.py` — `generate_profiles_yml()` adds a `postgres` output alongside the existing `dev` (DuckDB) output, with env_var placeholders for PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, PG_SCHEMA
- [ ] 4.2 Update existing `profiles_yml` tests to verify both targets are present and the `dev` target is unchanged
- [ ] 4.3 Verify `sources.yml` works for both targets: confirm dbt-postgres ignores the `external_location` meta key without compilation errors (manual test or integration test)

## 5. dbt Export Integration

- [ ] 5.1 Modify `generate_dbt_project_zip()` in `backend/app/use_cases/project/dbt/__init__.py` to include `scripts/bootstrap_db.sql` in the exported ZIP (call `generate_bootstrap_sql()` with a parameterized bucket placeholder)
- [ ] 5.2 Update `generate_readme()` in `readme.py` to add a "Postgres Setup" section with instructions for running `bootstrap_db.sql`, configuring pg_duckdb S3 secrets, and `dbt run --target postgres`
- [ ] 5.3 Update export integration tests to verify the ZIP contains `scripts/bootstrap_db.sql` and the README includes Postgres instructions

## 6. Backend: pg_duckdb Connection Manager

- [ ] 6.1 Create `backend/app/services/pg_duckdb_manager.py` with an async class that manages admin connections to the pg_duckdb instance (using asyncpg or psycopg against the admin role)
- [ ] 6.2 Implement `create_project_schema(short_id)`: executes `CREATE SCHEMA`, `CREATE ROLE` with random password, `GRANT USAGE`, `ALTER ROLE SET search_path`, `ALTER ROLE CONNECTION LIMIT 3`
- [ ] 6.3 Implement `drop_project_schema(short_id)`: executes `DROP SCHEMA CASCADE`, terminates active connections for the role via `pg_terminate_backend()`, then `DROP ROLE`
- [ ] 6.4 Implement `regenerate_credentials(short_id, new_password)`: executes `ALTER ROLE ... PASSWORD`
- [ ] 6.5 Implement `execute_bootstrap(schema_name, bootstrap_sql)`: runs the bootstrap SQL within a transaction against pg_duckdb
- [ ] 6.6 Implement `run_dbt(project_dir)`: writes dbt project files to temp dir, runs `dbt run --target postgres --project-dir ... --profiles-dir ...` via subprocess, captures exit code + stderr, cleans up temp dir
- [ ] 6.7 Write unit tests for credential generation (random password, bcrypt hashing) and schema name derivation (short_id from UUID)

## 7. Backend: Use Cases

- [ ] 7.1 Create `backend/app/use_cases/project/enable_sql_access.py` — validates project has datasets, calls pg_duckdb_manager to create schema + role, generates + executes bootstrap + dbt, creates ExternalAccess metadata record, returns connection details with plaintext password
- [ ] 7.2 Create `backend/app/use_cases/project/disable_sql_access.py` — calls pg_duckdb_manager to drop schema + role + terminate connections, updates ExternalAccess record to enabled=False
- [ ] 7.3 Create `backend/app/use_cases/project/sync_sql_access.py` — regenerates bootstrap SQL from current metadata, re-executes bootstrap + dbt, updates last_synced_at
- [ ] 7.4 Create `backend/app/use_cases/project/get_sql_access.py` — fetches ExternalAccess record, returns connection details (without password), returns enabled=False if no record
- [ ] 7.5 Create `backend/app/use_cases/project/regenerate_sql_credentials.py` — generates new password, calls pg_duckdb_manager, updates hash in metadata, returns plaintext once
- [ ] 7.6 Apply `@with_repositories` + `@handle_returns` decorator stack and org_id authorization checks (verify project ownership) on all use cases
- [ ] 7.7 Write unit tests for each use case (mock pg_duckdb_manager, mock repositories)

## 8. Backend: Router + Controller

- [ ] 8.1 Create `backend/app/controllers/sql_access_controller.py` with methods: post_enable, delete_disable, get_details, post_sync, post_regenerate — each delegates to the corresponding use case
- [ ] 8.2 Add routes to `backend/app/routers/projects.py` (or new `sql_access.py` router): `POST /api/projects/{id}/sql-access`, `DELETE /api/projects/{id}/sql-access`, `GET /api/projects/{id}/sql-access`, `POST /api/projects/{id}/sql-access/sync`, `POST /api/projects/{id}/sql-access/credentials`
- [ ] 8.3 Mount the new router in `backend/app/main.py`
- [ ] 8.4 Write router-level tests: auth enforcement (401/403), validation (no datasets → 400), happy paths (201/204/200)

## 9. Frontend: API Client + Query Hooks

- [ ] 9.1 Add API client methods in `frontend/src/lib/api/` for all sql-access endpoints (enable, disable, get, sync, regenerate)
- [ ] 9.2 Create TanStack Query hooks: `useSqlAccessQuery(projectId)` for connection details, `useEnableSqlAccess`, `useDisableSqlAccess`, `useSyncSqlAccess`, `useRegenerateCredentials` mutations
- [ ] 9.3 Add query key factory: `sqlAccessKeys.detail(projectId)` → `["sql-access", projectId]`

## 10. Frontend: Connection Details UI

- [ ] 10.1 Create `SqlAccessPanel` component — displays connection details (host, port, database, username), masked password field, copy-to-clipboard button with tooltip, sync button, disable button
- [ ] 10.2 Create `EnableSqlAccessButton` component for the project toolbar — shows "Enable SQL Access" when inactive, "Active" indicator when enabled, loading state during enable/sync
- [ ] 10.3 Add one-time password display: after enable or regenerate, show plaintext password in a dismissible alert with copy button and "This will only be shown once" warning
- [ ] 10.4 Add connection string copy: format as `postgresql://user:***@host:port/database` (mask password in displayed string, include plaintext in clipboard if password is visible)
- [ ] 10.5 Add sync button with loading state and `last_synced_at` display
- [ ] 10.6 Add status indicator: show warning icon + message when pg_duckdb health check fails
- [ ] 10.7 Integrate `SqlAccessPanel` and `EnableSqlAccessButton` into the project view layout

## 11. Integration Testing

- [ ] 11.1 Write integration test: enable SQL access → connect via psql/asyncpg to pg_duckdb → `SELECT * FROM dataset` → verify row data matches web UI preview
- [ ] 11.2 Write integration test: apply transform in web UI → sync → re-query → verify transforms reflected
- [ ] 11.3 Write integration test: enable → disable → verify schema dropped, role dropped, connection refused
- [ ] 11.4 Write integration test: enable for two projects → verify credentials for Project A cannot access Project B's schema
- [ ] 11.5 Write integration test: attempt INSERT/UPDATE/DELETE via external connection → verify permission denied
- [ ] 11.6 Write integration test: generate dbt export ZIP → extract → verify `scripts/bootstrap_db.sql` present and syntactically valid
- [ ] 11.7 Verify DuckDB macros (title_case, snake_case, kebab_case) register and execute correctly in pg_duckdb
