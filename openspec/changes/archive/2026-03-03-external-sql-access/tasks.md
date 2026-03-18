## 1. Infrastructure: Provisioner Abstraction

- [x] 1.1 Define `ProjectEnvironmentProvisioner` protocol with methods: `provision(project_id, storage_config) -> ProjectEnvironment`, `deprovision(project_id)`, `health_check(project_id) -> bool`, `get_environment(project_id) -> ProjectEnvironment | None`
- [x] 1.2 Define `ProjectEnvironment` dataclass with fields: environment_id, host, port, database, admin_user, admin_password
- [x] 1.3 Define `StorageConfig` dataclass with fields: endpoint, access_key, secret_key, region, url_style, use_ssl
- [x] 1.4 Implement `DockerPgDuckDbProvisioner` using `aiodocker`: container creation from configurable image, dynamic port mapping (0:5432), Docker network attachment, health check polling (pg_isready), S3 secret configuration via admin SQL, container naming (`dashboard-pgduckdb-{short_id}`), force-remove on teardown
- [x] 1.5 Implement `MockEnvironmentProvisioner` for tests: returns hardcoded ProjectEnvironment, tracks provision/deprovision calls for assertions
- [x] 1.6 Add `aiodocker` to `backend/pyproject.toml` dependencies
- [x] 1.7 Update `backend/app/config.py`: add `pg_duckdb_image`, `pg_duckdb_network`, `environment_provisioner`; remove static `pg_duckdb_host`, `pg_duckdb_port`, `pg_duckdb_external_host`, `pg_duckdb_external_port`
- [x] 1.8 Remove static `pg-duckdb` service from `docker-compose.yml`; add Docker socket mount (`/var/run/docker.sock`) to api service
- [x] 1.9 Write unit tests for DockerPgDuckDbProvisioner (mock aiodocker client)

## 2. Data Model: ExternalAccess Metadata (updated)

- [x] 2.1 Add columns to `ExternalAccessRecord`: `environment_id` (String, nullable), `environment_host` (String, nullable), `environment_port` (Integer, nullable)
- [x] 2.2 Create Alembic migration for the new columns (ALTER TABLE external_access ADD COLUMN)
- [x] 2.3 Update `ExternalAccessRepository` methods to handle environment fields: populate on create/update, clear on soft_disable, include in _to_dict()
- [x] 2.4 Update existing unit tests for repository changes

## 3. pg_duckdb Manager Refactor

- [x] 3.1 Refactor `pg_duckdb_manager.py`: all functions accept `ProjectEnvironment` parameter instead of reading from Settings
- [x] 3.2 Add `configure_s3_secrets(conn_info, storage_config)` function that runs DuckDB S3 secret creation SQL
- [x] 3.3 Update unit tests: pass ProjectEnvironment to all manager functions
- [x] 3.4 Verify all existing DDL logic (create_project_schema, drop_project_schema, execute_bootstrap, grant_schema_usage, regenerate_credentials) works with parameterized connections

## 4. Bootstrap SQL Generator (unchanged)

- [x] 4.1 `bootstrap_sql.py` is already implemented -- verify compatibility with new architecture (no changes expected)
- [x] 4.2 Existing tests pass without modification

## 5. Dual-Target dbt Profiles (unchanged)

- [x] 5.1 `profiles_yml.py` postgres target generation -- verify existing implementation
- [x] 5.2 Existing tests pass without modification

## 6. Backend: Use Cases (updated)

- [x] 6.1 Update `enable_sql_access.py`: call `provisioner.provision()` to get ProjectEnvironment, pass ProjectEnvironment to manager functions, store environment fields in ExternalAccessRecord, return dynamic host/port from ProjectEnvironment. Compensation: call `provisioner.deprovision()` on failure
- [x] 6.2 Update `disable_sql_access.py`: call `provisioner.deprovision()` instead of (or in addition to) `drop_project_schema()`. Container teardown destroys everything
- [x] 6.3 Update `sync_sql_access.py`: read ProjectEnvironment from ExternalAccessRecord (or call `provisioner.get_environment()`), verify environment is running, then execute bootstrap + dbt
- [x] 6.4 Update `get_sql_access.py`: read host/port from ExternalAccessRecord (dynamic), include environment status
- [x] 6.5 Update `regenerate_sql_credentials.py`: read ProjectEnvironment from record, connect to project's container for ALTER ROLE
- [x] 6.6 Add provisioner injection to use cases (via RepositoryContainer or separate dependency)
- [x] 6.7 Update all use case unit tests: use MockEnvironmentProvisioner instead of mocking asyncpg connections

## 7. Backend: Router + Controller (mostly unchanged)

- [x] 7.1 Verify router endpoints handle dynamic connection details in responses
- [x] 7.2 Add provisioner startup/shutdown to application lifecycle (main.py)
- [x] 7.3 Add startup reconciliation: on app start, compare running containers with enabled ExternalAccessRecords, deprovision orphans

## 8. dbt Export Integration

- [x] 8.1 Include `scripts/bootstrap_db.sql` in exported ZIP (existing work)
- [x] 8.2 Update README with pg_duckdb setup instructions
- [x] 8.3 Verify exported project is self-contained and runs against external pg_duckdb

## 9. Frontend: API Client + Query Hooks (unchanged)

- [x] 9.1-9.3 Same as before (API client, hooks, key factory) -- host/port now come from API response instead of being hardcoded

## 10. Frontend: Connection Details UI (minor updates)

- [x] 10.1-10.7 Same as before, but connection details panel reads dynamic host/port from API
- [x] 10.8 Add environment status indicator (running/stopped/error) based on API response

## 11. Integration Testing (updated) — requires Docker environment with pg_duckdb

- [ ] 11.1 Integration test: enable -> verify container launched -> connect -> query -> verify data
- [ ] 11.2 Integration test: sync -> re-query -> verify transforms reflected
- [ ] 11.3 Integration test: disable -> verify container removed -> connection refused
- [ ] 11.4 Integration test: multi-project -> each has its own container -> cross-project access denied
- [ ] 11.5 Integration test: read-only enforcement -> INSERT/UPDATE/DELETE rejected
- [ ] 11.6 Integration test: dbt export ZIP contains bootstrap script
- [ ] 11.7 Integration test: orphan container cleanup on startup
