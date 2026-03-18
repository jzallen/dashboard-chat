# Capability: Stable Credential Proxy

**Status**: ADDED
**Domain**: sql-access

## Overview

PgBouncer-based credential proxy providing a stable PostgreSQL endpoint per project. Users authenticate against PgBouncer with stable credentials; PgBouncer transparently forwards to the ephemeral pg_duckdb container.

## Behaviors

### Proxy Provisioning

- When SQL Access is enabled for a project, a PgBouncer sidecar container is provisioned alongside the pg_duckdb container
- The PgBouncer container is named `dashboard-pgbouncer-{project_id[:8]}`
- The PgBouncer container joins the same Docker network as the pg_duckdb container
- The PgBouncer container binds to a stable port allocated from a configurable range (default 6432-7431)
- The allocated port is persisted in the metadata database and reused across container recreations
- PgBouncer uses `auth_type = md5` with `auth_file` for client authentication
- PgBouncer uses `pool_mode = session` to preserve pg_duckdb's session-level state (DuckDB extensions, search_path)

### Credential Generation

- When SQL Access is enabled, a 32-character alphanumeric password is generated using `secrets.choice()`
- The username is system-generated: `reader_{project_id[:8]}`
- A PostgreSQL md5 hash is computed: `"md5" + md5(password + username)`
- The md5 hash is stored in `ExternalAccessRecord.pg_password_hash`
- The same md5 hash is used in both PgBouncer's `userlist.txt` and the pg_duckdb role's `PASSWORD`
- The plaintext password is returned once in the enable API response and never persisted
- Subsequent GET requests never return the password

### Credential Stability

- The stable credentials (username + md5 hash) survive pg_duckdb container restarts
- When pg_duckdb restarts, reconciliation re-creates the reader role with `ALTER ROLE ... PASSWORD 'md5<stored_hash>'`
- PgBouncer remains running during pg_duckdb restarts, accepting connections on the stable port
- Clients connected to PgBouncer when pg_duckdb is down receive a clean PostgreSQL error ("connection to server failed"), not a TCP connection refused

### Credential Regeneration

- When the user regenerates credentials, a new password and md5 hash are generated
- The pg_duckdb role's password is updated via `ALTER ROLE`
- PgBouncer is recreated with the new auth_file (sub-second interruption)
- The old password stops working immediately for new connections
- Regeneration is rate-limited: rejected if < 60 seconds since last regeneration (HTTP 429)

### Proxy Teardown

- When SQL Access is disabled, both PgBouncer and pg_duckdb containers are removed
- The allocated port is freed (set to NULL in the database)
- The stable credentials are permanently invalidated

### Port Allocation

- Ports are allocated sequentially from a configurable range: `PGBOUNCER_PORT_RANGE_START` to `PGBOUNCER_PORT_RANGE_END`
- The next available port is determined by querying the database for used ports
- The allocated port is stored in `ExternalAccessRecord.environment_port`
- Ports are released when SQL Access is disabled
- If the port range is exhausted, a `PortRangeExhausted` error is returned

## Connection Details

The user-facing connection string format:
```
postgresql://{username}:{password}@{host}:{proxy_port}/{database}?options=--search_path%3D{schema}
```

Where:
- `username` = `reader_{project_id[:8]}`
- `host` = `localhost` (Docker dev) or configured domain (production)
- `proxy_port` = stable allocated port (e.g., 6433)
- `database` = `dashboard_external`
- `schema` = `project_{project_id[:8]}`

## Error States

- **Port allocation failure**: No available ports in range → HTTP 503 "Port range exhausted"
- **PgBouncer provision failure**: pg_duckdb is deprovisioned as compensation → HTTP 500 with error detail
- **PgBouncer recreation failure during regeneration**: Old credentials are preserved → HTTP 500 with error detail
