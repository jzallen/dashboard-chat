## Why

Users who enable SQL Access get connection credentials that break on every environment restart. The ephemeral pg_duckdb container rotates its credentials and port on each restart, forcing BI tool users (Excel, Tableau, Power BI, dbt) to reconfigure their connections constantly. This violates the "connect once, query forever" expectation of production BI workflows.

Additionally, users have no way to pause their SQL environment without fully disabling it (which destroys credentials and requires re-setup). There is no visibility into whether the environment is healthy, degraded, or stopped.

These two gaps — credential instability and missing environment lifecycle controls — make SQL Access unreliable for real-world BI integration.

## What Changes

- **New: PgBouncer credential proxy** — A PgBouncer sidecar container per project provides a stable connection endpoint. Users authenticate against PgBouncer with stable credentials; PgBouncer forwards to the ephemeral pg_duckdb container using internal credentials. The proxy persists across pg_duckdb restarts, keeping the user-facing host:port stable.

- **New: stable credential management** — A single md5 PostgreSQL password hash is shared between PgBouncer's auth_file and the pg_duckdb role. This eliminates the need for separate "stable" and "ephemeral" passwords. Credentials survive restarts because the hash is stored in the metadata DB and re-applied during reconciliation.

- **New: environment lifecycle controls** — Start/Stop/Restart operations decouple the pg_duckdb container lifecycle from Enable/Disable. Stopping pauses the environment (saves resources) while preserving credentials and the proxy endpoint. Starting brings it back with the same connection details.

- **New: environment status visibility** — Real-time status (Running, Stopped, Degraded, Provisioning, Error) displayed in the UI with color-coded badges. Auto-refreshing via polling (15-second interval).

- **Modified: connection card** — Per-field copy buttons, full `postgresql://` connection string, monospace values, masked sensitive fields with eye toggles. Connection details always point to the stable proxy endpoint.

- **Modified: enable/disable flows** — Enable now provisions both PgBouncer + pg_duckdb, allocates a stable port, and generates credentials. Disable tears down both containers and invalidates credentials.

- **Modified: regenerate credentials** — Rotates the stable password (updates PgBouncer auth_file + pg_duckdb role in one operation). Brief sub-second interruption during PgBouncer recreation.

- **Modified: reconciliation** — On startup, also checks PgBouncer health alongside pg_duckdb. Re-applies credential hash to pg_duckdb if the container restarted.

## Capabilities

### New Capabilities
- `stable-credential-proxy`: PgBouncer-based credential proxy providing stable connection endpoints per project. Includes proxy lifecycle management, port allocation from a configurable range, auth_file-based authentication, and credential mapping between the stable user-facing identity and the ephemeral pg_duckdb role.
- `environment-lifecycle`: Start/Stop/Restart operations for the pg_duckdb container independent of enable/disable. Includes status tracking (running, stopped, degraded, provisioning, error), status polling API, and UI controls.
- `connection-card-v2`: Enhanced connection details card with per-field copy, full connection string display, masked sensitive fields, and consistent monospace formatting.

### Modified Capabilities
- `external-sql-access`: Extended with proxy provisioning in enable/disable, credential reconciliation on restart, and environment status in API responses.

## Impact

**Backend**
- New: `DockerPgBouncerProvisioner` for PgBouncer container lifecycle (create, remove, recreate)
- New: Port allocation service (sequential from configurable range, persisted in DB)
- New API endpoints: `POST/POST/POST/GET .../environment/{start,stop,restart,status}`
- Modified: `ExternalAccessRecord` gains `proxy_container_id`, `environment_status`, `status_message` columns
- Modified: `pg_password_hash` changes from bcrypt to md5 PostgreSQL format (migration required)
- Modified: enable/disable/reconcile use cases incorporate PgBouncer lifecycle
- New Alembic migration for schema changes

**Infrastructure**
- New container type: PgBouncer sidecar per project (`dashboard-pgbouncer-{short_id}`)
- PgBouncer Docker image dependency (e.g., `edoburu/pgbouncer:1.22` or `bitnami/pgbouncer`)
- New config settings: `PGBOUNCER_IMAGE`, `PGBOUNCER_PORT_RANGE_START`, `PGBOUNCER_PORT_RANGE_END`

**Frontend**
- Modified: `SqlAccessPanel` gains environment controls section (start/stop/restart buttons)
- Modified: `ConnectionDetails` gains per-field copy, connection string, status badge
- New: status polling hook with 15-second interval
- New API client methods for environment lifecycle endpoints

**Worker**
- No changes

**Security**
- md5 hash replaces bcrypt for pg_password_hash (acceptable: 32-char random passwords, internal use, Docker-network scoped)
- PgBouncer-to-pg_duckdb traffic on Docker internal network (not exposed)
- Stable port is host-bound (accessible from localhost only in dev)
- Credential regeneration rate-limited to prevent abuse

## Architectural Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Credential proxy | PgBouncer with auth_file | Battle-tested, PostgreSQL-wire-compatible, auth_file works when upstream is down |
| 2 | Deployment model | Sidecar per project | Simple isolation, matches existing provisioner pattern, ~5MB overhead per container |
| 3 | Port assignment | Sequential from DB-tracked range | No collisions (DB is source of truth), stable across restarts, simple allocation |
| 4 | TLS termination | Deferred to production | Not needed for localhost dev; PgBouncer supports client_tls_* when ready |
| 5 | Credential storage | md5 PostgreSQL hash | Single hash usable by both PgBouncer and PostgreSQL; eliminates dual-password complexity |
| 6 | Migration strategy | Require disable/re-enable | Lowest risk, simple UX with banner guidance, few existing users |
