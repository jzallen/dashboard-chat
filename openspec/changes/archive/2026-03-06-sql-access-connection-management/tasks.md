# Tasks: SQL Access Connection Management

## Phase 1: Data Model & Credential Foundation

- [x] 1.1 Create Alembic migration: add `proxy_container_id` (String 255, nullable), `environment_status` (String 50, server_default "running", not null), `status_message` (Text, nullable) to `external_access` table
- [x] 1.2 Update `ExternalAccessRecord` model class with new columns. Update `ExternalAccessRepository._to_dict()` to include `environment_status`, `status_message`, and computed `is_legacy` field (true when `enabled=True` and `proxy_container_id is None`)
- [x] 1.3 Replace `hash_password()` (bcrypt) with `pg_md5_hash(password, username)` in `pg_duckdb_manager.py`. New function: `"md5" + hashlib.md5((password + username).encode()).hexdigest()`. Keep `generate_password()` unchanged
- [x] 1.4 Update `soft_disable()` to also clear `proxy_container_id`, set `environment_status` to null. Update `create()`/`update()` to handle new fields
- [x] 1.5 Write unit tests for `pg_md5_hash()` — verify format matches PostgreSQL's expected md5 password hash. Write unit tests for repository changes

## Phase 2: Port Allocation Service

- [x] 2.1 Add settings to `config.py`: `pgbouncer_image` (default `"edoburu/pgbouncer:1.22"`), `pgbouncer_port_range_start` (default `6432`), `pgbouncer_port_range_end` (default `7431`), `pgbouncer_max_client_conn` (default `20`), `pgbouncer_default_pool_size` (default `5`), `credential_regen_cooldown_seconds` (default `60`)
- [x] 2.2 Implement `allocate_proxy_port(session)` function (in `sql_access/` package): query `ExternalAccessRecord` for all non-null `environment_port` values, iterate range to find first unused port, raise `PortRangeExhausted` if none available
- [x] 2.3 Write unit tests for port allocation: basic allocation, sequential allocation, exhaustion error, port reclamation after disable

## Phase 3: PgBouncer Provisioner

- [x] 3.1 Create `sql_access/pgbouncer_provisioner.py` with `DockerPgBouncerProvisioner` class. Methods: `provision(project_id, proxy_port, md5_hash, upstream_host) -> container_id`, `deprovision(project_id)`, `health_check(project_id) -> bool`, `recreate(project_id, proxy_port, md5_hash, upstream_host) -> container_id`. Container naming: `dashboard-pgbouncer-{project_id[:8]}`. Uses `aiodocker` (same pattern as `DockerPgDuckDbProvisioner`)
- [x] 3.2 PgBouncer container creation: env vars for `DB_HOST`, `DB_PORT`, `DB_NAME`, `AUTH_USER`, `AUTH_PASSWORD_HASH`, `LISTEN_PORT`, `POOL_MODE=session`, `MAX_CLIENT_CONN`, `DEFAULT_POOL_SIZE`. Port binding: `{proxy_port}:6432`. Network: same compose network. Health check: TCP connect to container_name:6432
- [x] 3.3 Evaluate PgBouncer Docker image (`edoburu/pgbouncer:1.22`) for auth_file env var support. If insufficient, create minimal Dockerfile (Alpine + PgBouncer + shell entrypoint that generates `pgbouncer.ini` and `userlist.txt` from env vars). Place in `infrastructure/pgbouncer/` or similar
- [x] 3.4 Write unit tests for `DockerPgBouncerProvisioner` (mock aiodocker). Test: provision creates container with correct config, deprovision removes container, health_check returns bool, recreate removes then creates
- [x] 3.5 Add `MockPgBouncerProvisioner` to `provisioner.py` for use case tests

## Phase 4: Provisioner Protocol Extension

- [x] 4.1 Add `EnvironmentStatus` dataclass to `provisioner.py`: fields `pgduckdb_running` (bool), `pgbouncer_running` (bool), `status` (str), `message` (str | None)
- [x] 4.2 Extend `ProjectEnvironment` dataclass: add `proxy_container_id` (str) field. Existing `host`/`port` now represent the proxy endpoint (not pg_duckdb direct)
- [x] 4.3 Add methods to `ProjectEnvironmentProvisioner` protocol: `start_environment(project_id, storage_config) -> ProjectEnvironment`, `stop_environment(project_id)`, `get_detailed_status(project_id) -> EnvironmentStatus`
- [x] 4.4 Implement new protocol methods in `DockerPgDuckDbProvisioner`: `start_environment` provisions pg_duckdb only + recreates PgBouncer with new upstream; `stop_environment` removes pg_duckdb only; `get_detailed_status` checks both container states
- [x] 4.5 Update `provision()`: after pg_duckdb provision, also create PgBouncer via `DockerPgBouncerProvisioner`. Return `ProjectEnvironment` with proxy details
- [x] 4.6 Update `deprovision()`: remove PgBouncer first, then pg_duckdb
- [x] 4.7 Update `MockEnvironmentProvisioner` with new methods
- [x] 4.8 Update provisioner unit tests for extended protocol

## Phase 5: Use Case Changes

- [x] 5.1 **enable_sql_access.py**: After provisioning pg_duckdb, allocate proxy port, create PgBouncer container, store `proxy_container_id` and `environment_status="running"` in record. Use `pg_md5_hash()` instead of `hash_password()`. Return proxy `host:port` (not pg_duckdb port). Add compensation: on PgBouncer failure, deprovision pg_duckdb + release port
- [x] 5.2 **disable_sql_access.py**: Call PgBouncer deprovision before pg_duckdb deprovision. Clear `proxy_container_id`. Set `environment_port = None` (release port)
- [x] 5.3 **regenerate_sql_credentials.py**: Generate new md5 hash. ALTER ROLE with md5 hash. Recreate PgBouncer with new auth hash. Add rate limiting: check `updated_at` field, reject if < `credential_regen_cooldown_seconds` ago (HTTP 429 with Retry-After header). Add compensation: if PgBouncer recreation fails, restore old hash on pg_duckdb role
- [x] 5.4 **sync_sql_access.py**: No credential changes needed. Continue to use `get_environment()` for internal pg_duckdb connection (bootstrap runs against pg_duckdb directly, not through PgBouncer)
- [x] 5.5 **get_sql_access.py**: Add `environment_status`, `status_message`, and `is_legacy` to response
- [x] 5.6 **reconcile_sql_access.py**: Check both PgBouncer and pg_duckdb health. Re-apply md5 hash to pg_duckdb role after restart (`ALTER ROLE ... PASSWORD 'md5<stored_hash>'`). Recreate PgBouncer if it exited. Update `environment_status` in DB. Skip proxy checks for legacy records
- [x] 5.7 Create new use case: **start_environment.py** — validate enabled + stopped/error, set status "provisioning", provision pg_duckdb, create role from stored hash, bootstrap views, recreate PgBouncer with new upstream, set status "running". On failure: set status "error" + message
- [x] 5.8 Create new use case: **stop_environment.py** — validate enabled + running/degraded, deprovision pg_duckdb only, set status "stopped"
- [x] 5.9 Create new use case: **restart_environment.py** — orchestrate stop + start. Handle partial failure (stop succeeds but start fails → set "error")
- [x] 5.10 Create new use case: **get_environment_status.py** — call `provisioner.get_detailed_status()`, return status + message
- [x] 5.11 Write unit tests for all modified and new use cases. Use MockEnvironmentProvisioner + MockPgBouncerProvisioner. Test compensation flows

## Phase 6: API Routes

- [x] 6.1 Add new routes to `routers/sql_access.py`: `POST .../environment/start`, `POST .../environment/stop`, `POST .../environment/restart`, `GET .../environment/status`. All guarded by `use_db_context` + `AuthMiddleware`
- [x] 6.2 Add controller methods for new routes (or inline in router, matching existing pattern)
- [x] 6.3 Update GET `/sql-access` response to include `environment_status`, `status_message`, `is_legacy`
- [x] 6.4 Add rate limiting response (429) to credentials endpoint
- [x] 6.5 Write router unit tests for new endpoints

## Phase 7: Docker & Infrastructure

- [x] 7.1 Add new env vars to `docker-compose.yml` for dashboard-api: `PGBOUNCER_IMAGE`, `PGBOUNCER_PORT_RANGE_START`, `PGBOUNCER_PORT_RANGE_END`
- [x] 7.2 If custom PgBouncer image needed (from task 3.3): create `infrastructure/pgbouncer/Dockerfile` and `infrastructure/pgbouncer/entrypoint.sh`. Entrypoint generates `pgbouncer.ini` and `userlist.txt` from env vars, then `exec pgbouncer`
- [x] 7.3 Add PgBouncer image pull to provisioner startup (same pattern as pg_duckdb image pull)

## Phase 8: Frontend — API Client & Hooks

- [x] 8.1 Update `SqlAccessStatus` interface in `sqlAccess.ts`: add `environment_status`, `status_message`, `is_legacy` fields
- [x] 8.2 Add new API client functions: `startEnvironment(projectId)`, `stopEnvironment(projectId)`, `restartEnvironment(projectId)`, `getEnvironmentStatus(projectId)`
- [x] 8.3 Add new TanStack Query hooks: `useEnvironmentStatus(projectId)` with 15s polling interval, `useStartEnvironment()`, `useStopEnvironment()`, `useRestartEnvironment()` mutations with cache invalidation
- [x] 8.4 Update existing hooks' `onSuccess` callbacks to also invalidate `["sql-access", projectId, "status"]` query key

## Phase 9: Frontend — Connection Card V2

- [x] 9.1 Refactor `ConnectionDetails` component: add individual copy buttons to each field (Host, Port, Database, Username, Schema). Use existing `CopyButton` component pattern
- [x] 9.2 Add full connection string display below field grid: `postgresql://...` format, masked by default with eye toggle, copy button. When password not in local state, omit password from connection string
- [x] 9.3 Add monospace font (`font-mono`) to all connection detail values
- [x] 9.4 Add status badge component: color-coded dot (green/yellow/gray/red) + label. Use for both section header and environment controls section

## Phase 10: Frontend — Environment Controls

- [x] 10.1 Add Environment Controls section below connection card in `SqlAccessPanel`: status display + action buttons
- [x] 10.2 Implement button states: Start (when stopped/error), Stop (when running/degraded), Restart (when running/degraded), Retry (when error). All disabled during provisioning
- [x] 10.3 Add loading/pending states during start/stop/restart (disable buttons, show spinner)
- [x] 10.4 Add "Environment is stopped" note on connection card when status is "stopped"
- [x] 10.5 Add degraded state warning message display
- [x] 10.6 Add error state error message display with Retry button

## Phase 11: Frontend — Legacy Migration Banner

- [x] 11.1 Add `LegacyMigrationBanner` component: shown when `is_legacy === true`, explains upgrade needed, includes Disable button
- [x] 11.2 Wire into `SqlAccessPanel`: when legacy, show banner instead of connection card + environment controls

## Phase 12: Integration Testing

- [x] 12.1 Integration test: enable → verify both PgBouncer + pg_duckdb containers launched → connect via PgBouncer port → query → verify data
- [x] 12.2 Integration test: stop → verify pg_duckdb removed + PgBouncer still running → verify connection via PgBouncer gets clean error → start → verify same credentials work
- [x] 12.3 Integration test: regenerate credentials → verify old password fails → new password works → PgBouncer recreated on same port
- [x] 12.4 Integration test: restart → verify connection briefly interrupts → same credentials work after
- [x] 12.5 Integration test: credential stability across pg_duckdb restart — simulate container death, reconcile, verify same credentials work
- [x] 12.6 Integration test: disable → verify both containers removed → re-enable → verify new credentials, new port possible
- [x] 12.7 Integration test: port allocation — enable multiple projects → verify unique ports → disable one → enable another → verify port reuse
