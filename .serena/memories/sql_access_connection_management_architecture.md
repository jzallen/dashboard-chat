# SQL Access Connection Management — Architecture Decisions

## Date: 2026-02-26
## Status: Design complete, pending implementation
## Change: openspec/changes/sql-access-connection-management/

## 6 Architectural Decisions

### 1. Credential Proxy: PgBouncer with auth_file
- PgBouncer sidecar per project provides stable PostgreSQL endpoint
- `auth_file` (not `auth_query`) — works when upstream pg_duckdb is down
- Container recreation (not in-place config update) for credential changes
- PgBouncer starts in ~100ms — sub-second interruption on recreation

### 2. Deployment: Sidecar per project
- One PgBouncer container per SQL Access-enabled project (~5MB each)
- Container naming: `dashboard-pgbouncer-{project_id[:8]}`
- Matches existing provisioner pattern
- Independent failure domains per project

### 3. Port Assignment: Sequential from DB-tracked range
- Range: 6432-7431 (configurable)
- Allocated by querying DB for used ports, taking first available
- Stored in ExternalAccessRecord.environment_port
- Released on disable

### 4. TLS: Deferred to production
- Not needed for localhost dev
- PgBouncer supports client_tls_* when ready
- Document production TLS setup path

### 5. Credential Storage: Single md5 PostgreSQL hash
- KEY INSIGHT: Same md5 hash used by BOTH PgBouncer auth_file AND pg_duckdb role
- Format: "md5" + md5(password + username) — PostgreSQL standard
- No dual-password system needed
- PgBouncer can do md5 challenge-response on both client and server sides using just the hash
- Replaces bcrypt (breaking change for existing records)
- Reconciliation restores credentials: ALTER ROLE ... PASSWORD 'md5<stored_hash>'

### 6. Migration: Disable/re-enable for existing projects
- Legacy detected by proxy_container_id IS NULL
- UI shows migration banner with guidance
- Simple, low-risk, uses existing code paths

## Key Data Model Changes
- ExternalAccessRecord gains: proxy_container_id, environment_status, status_message
- pg_password_hash changes from bcrypt to md5 format
- environment_host/environment_port now point to PgBouncer (was pg_duckdb direct)

## Provisioner Protocol Extensions
- New methods: start_environment(), stop_environment(), get_detailed_status()
- provision() now creates both pg_duckdb + PgBouncer
- deprovision() removes both (PgBouncer first)
