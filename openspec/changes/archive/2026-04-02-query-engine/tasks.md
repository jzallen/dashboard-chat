## 1. Query Engine Service & Data Model

- [x] 1.1 Add `query-engine` service to docker-compose (pgduckdb image, S3 env vars, health check, resource limits)
- [x] 1.2 Create init script for query engine startup (load httpfs, configure S3 secrets, create `duckdb_readers` group role, set GUC)
- [x] 1.3 Create `QueryEngineNode` SQLAlchemy model (id, org_id, name, host, port, database, admin_user, admin_password_encrypted, status, status_message, created_at, updated_at) with unique constraint on (org_id, name)
- [x] 1.4 Create Alembic migration for `query_engine_nodes` table
- [x] 1.5 Add `engine_node_id` FK (nullable) to `ExternalAccessRecord` model, add `pg_proxy_role` field, remove `environment_id`/`environment_host`/`environment_port`/`proxy_container_id` fields
- [x] 1.6 Create Alembic migration for ExternalAccessRecord schema changes (add engine_node_id FK, add pg_proxy_role, drop removed columns)
- [x] 1.7 Implement default engine node seeding on backend startup (read from settings, create if missing, health check, update status)

## 2. Query Engine Provisioner

- [x] 2.1 Define `QueryEngineProvisioner` protocol (create_project_access, drop_project_access, sync_views, health_check)
- [x] 2.2 Implement `QueryEngineProvisioner` using asyncpg against engine node connection
- [x] 2.3 Add proxy role support to `pg_duckdb_manager.py` (create_proxy_role, regenerate_proxy_credentials, grant SET ROLE)
- [x] 2.4 Update `create_project_schema()` to create both internal role (reader_) and proxy role (proxy_)
- [x] 2.5 Update `drop_project_schema()` to drop both internal and proxy roles
- [x] 2.6 Create `MockQueryEngineProvisioner` for tests
- [x] 2.7 Remove `docker_provisioner.py`, `pgbouncer_provisioner.py`, `port_allocation.py`
- [x] 2.8 Remove `aiodocker` dependency from pyproject.toml

## 3. Backend Analytical Query Migration

- [x] 3.1 Create asyncpg connection pool to query engine in `database.py` (init on startup, close on shutdown)
- [x] 3.2 Migrate `lake/repository.py` `read_parquet_preview()` from Ibis/DuckDB to asyncpg query via engine
- [x] 3.3 Migrate `lake/repository.py` `get_parquet_row_count()` to asyncpg query via engine
- [x] 3.4 Migrate `lake/repository.py` `get_parquet_column_type()` to asyncpg query via engine
- [x] 3.5 Migrate `lake/repository.py` `preview_cleaning_operation()` to asyncpg query via engine
- [x] 3.6 Migrate `dataset.py` `_build_table()` and `_get_connection()` to asyncpg query via engine
- [x] 3.7 Remove `duckdb_factory.py`
- [x] 3.8 Remove `ibis-framework[duckdb]` dependency from pyproject.toml (or reduce to non-DuckDB usage if Ibis is used elsewhere)
- [x] 3.9 Update tests for migrated lake repository methods

## 4. Event-Driven Sync

- [x] 4.1 Define new outbox event types: `DatasetSyncRequested`, `TransformSyncRequested`, `DatasetRemoved`
- [x] 4.2 Add outbox event emission in dataset creation use case (when project has SQL access enabled)
- [x] 4.3 Add outbox event emission in transform create/update/delete use cases (when project has SQL access enabled)
- [x] 4.4 Add outbox event emission in dataset deletion use case (when project has SQL access enabled)
- [x] 4.5 Implement sync processor background task (poll outbox, execute view DDL against engine, mark processed)
- [x] 4.6 Add exponential backoff retry for failed sync events
- [x] 4.7 Register sync processor as asyncio background task on backend startup
- [x] 4.8 Implement per-dataset sync status derivation from outbox state (synced/pending/error)
- [x] 4.9 Add per-dataset sync status to SQL access API response
- [x] 4.10 Write tests for sync processor (event processing, retry, failure handling)

## 5. Enable/Disable Use Case Rewrite

- [x] 5.1 Rewrite `enable_sql_access.py` to use QueryEngineProvisioner (create schema + internal role + proxy role in engine, no container provisioning)
- [x] 5.2 Rewrite `disable_sql_access.py` to use QueryEngineProvisioner (drop schema + roles, no container deprovisioning)
- [x] 5.3 Update `sync_sql_access.py` to use QueryEngineProvisioner and engine node connection
- [x] 5.4 Update `regenerate_sql_credentials.py` to regenerate proxy role password only
- [x] 5.5 Update `get_sql_access.py` to derive connection details from engine node + include per-dataset sync status
- [x] 5.6 Remove `start_environment.py`, `stop_environment.py`, `restart_environment.py`, `get_environment_status.py`, `reconcile_sql_access.py`
- [x] 5.7 Update SQL access router to remove environment lifecycle endpoints (start/stop/restart/status)
- [x] 5.8 Update tests for rewritten use cases

## 6. Query Engine API Endpoints

- [x] 6.1 Create `QueryEngineNodeRepository` (CRUD operations, list by org_id, get with project count)
- [x] 6.2 Create `list_query_engines` use case (list nodes for org)
- [x] 6.3 Create `get_query_engine` use case (get node detail with connected projects and sync status)
- [x] 6.4 Create `test_query_engine` use case (health check with timing)
- [x] 6.5 Create query engines router (`GET /api/query-engines`, `GET /api/query-engines/{id}`, `POST /api/query-engines/{id}/test`)
- [x] 6.6 Create query engines controller
- [x] 6.7 Mount router in `main.py`
- [x] 6.8 Write tests for query engine API endpoints

## 7. Frontend — Engine List & Detail Views

- [x] 7.1 Add `queryEngineKeys` key factory for TanStack Query
- [x] 7.2 Create `useQueryEnginesQuery` and `useQueryEngineDetailQuery` hooks
- [x] 7.3 Create `useTestQueryEngine` mutation hook
- [x] 7.4 Create `QueryEngineList` component (table of engines with status, endpoint, project count)
- [x] 7.5 Create `QueryEngineDetail` component (connection strings, connected projects, quick-start guides)
- [x] 7.6 Add routes for `/query-engines` and `/query-engines/:id`
- [x] 7.7 Add "Query Engines" navigation item to org settings / nav sidebar
- [x] 7.8 Implement status polling with `refetchInterval` on engine queries

## 8. Frontend — Rework SQL Access Panel

- [x] 8.1 Rework `SqlAccessPanel` to show permissions & sync status view when enabled
- [x] 8.2 Add per-dataset sync status list (synced/pending/error indicators)
- [x] 8.3 Add link to engine detail view from project panel
- [x] 8.4 Update credential display to show proxy role username + masked password + regenerate
- [x] 8.5 Replace environment controls (start/stop/restart) with "Force Sync" button
- [x] 8.6 Remove `LegacyMigrationBanner` and `EnvironmentControls` components
- [x] 8.7 Remove `useEnvironmentStatus`, `useStartEnvironment`, `useStopEnvironment`, `useRestartEnvironment` hooks
- [x] 8.8 Update `useSqlAccessQuery` response type to include engine_node_id and per-dataset sync status
- [x] 8.9 Write tests for reworked SqlAccessPanel

## 9. Cleanup & Migration

- [x] 9.1 Remove Docker socket mount from backend service in docker-compose
- [x] 9.2 Create migration script that reads existing ExternalAccessRecords, creates a default QueryEngineNode, and backfills engine_node_id FK
- [x] 9.3 Update backend config.py to add query engine connection settings (host, port, admin user, admin password)
- [x] 9.4 Update .env.example and devcontainer config with query engine environment variables
- [x] 9.5 Update existing feature file `external-data-access.feature` to reference `query-engine.feature` as superseding spec
- [x] 9.6 Run full test suite and fix any regressions
