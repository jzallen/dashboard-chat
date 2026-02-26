# SQL Access: Connection Management UI & Credential Proxy

## Summary

After enabling SQL Access, users need to see their connection details and manage the ephemeral pgduckdb environment from the UI. This involves two things:

1. **Connection card** — Display obfuscated connection credentials with a stable username/password that maps to the ephemeral container credentials
2. **Environment controls** — Start/stop the pgduckdb container with status visibility, below the connection card

The core challenge is that BI tools (Excel, Tableau, Power BI) need a stable connection string, but the pgduckdb containers are ephemeral with generated credentials that rotate on restart. A credential proxy layer solves this by giving users persistent credentials that are transparently mapped to the current ephemeral ones.

## Current State

The frontend `SqlAccessPanel` already shows connection details (host, port, database, username, schema) after enablement and supports password reveal, credential regeneration, sync, and disable. The backend provisions ephemeral pgduckdb containers per project with reader roles and manages the full lifecycle.

What's missing:
- **Stable credential identity** — Currently, credentials rotate with the container. Users must update their BI tool connection every time.
- **Environment controls** — No way to start/stop the container independently of enable/disable. No status indicator (running, stopped, degraded).
- **Connection card refinement** — The password is shown one-time after enable/regenerate, but the card should also clearly indicate which fields are safe to copy vs. sensitive.

## Design: Credential Proxy via PgBouncer

### Why PgBouncer

PgBouncer with `auth_query` is the recommended approach for this use case:

- **Battle-tested** — Standard PostgreSQL connection pooler, widely deployed
- **BI tool compatible** — Transparent to clients; connection string never changes
- **Minimal overhead** — Lightweight C process, negligible latency
- **auth_query** — Authenticates users against a lookup function rather than a static file, allowing dynamic credential mapping

### Architecture

```
BI Tool (Excel/Tableau/dbt)
    |
    | stable credentials (user-chosen username + password)
    v
PgBouncer (persistent, per-project)
    |
    | auth_query → credential_mapping table
    | resolves ephemeral username + password
    v
Ephemeral pgduckdb container
    |
    | read_parquet('s3://...')
    v
MinIO / S3 (Parquet files)
```

### Credential Flow

1. User clicks "Enable SQL Access" (existing flow)
2. Backend provisions ephemeral pgduckdb container (existing)
3. **New**: Backend also provisions a PgBouncer sidecar (or shared instance)
4. User sets a stable username/password via the UI (or system generates one)
5. Backend stores mapping: `stable_user → ephemeral_reader_xyz / ephemeral_pass`
6. When container rotates (restart, reprovisioning), only the mapping row updates
7. User's BI tool connection string remains unchanged

### PgBouncer Configuration

```ini
; pgbouncer.ini
[databases]
project_abc = host=dashboard-pgduckdb-abc12345 port=5432 dbname=dashboard_external

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 6432
auth_type = md5
auth_query = SELECT username, password FROM credential_mapping WHERE stable_username=$1
pool_mode = session          ; pg_duckdb needs session-level state
max_client_conn = 20
default_pool_size = 5
```

### Bootstrap Flow (Updated)

```
enable_sql_access()
  1. Provision pgduckdb container (existing)
  2. Create schema + reader role (existing)
  3. Bootstrap views (existing)
  4. NEW: Generate stable credentials (or accept user-provided)
  5. NEW: Upsert credential_mapping row
  6. NEW: Start/configure PgBouncer with auth_query pointing to mapping table
  7. Return stable connection details to frontend
```

### Credential Rotation

When the ephemeral container restarts or is reprovisioned:

```
reconcile_sql_access()
  1. Detect container state (existing)
  2. Re-apply GUC + S3 secrets (existing)
  3. NEW: Update credential_mapping with new ephemeral creds
  4. PgBouncer picks up new mapping on next auth_query call
```

User's stable credentials are unaffected.

## Alternative Approaches Considered

### PostgreSQL Foreign Data Wrapper (USER MAPPING)

```sql
CREATE SERVER ephemeral_workspace FOREIGN DATA WRAPPER postgres_fdw
  OPTIONS (host 'workspace-xyz', dbname 'analytics', port '5432');

CREATE USER MAPPING FOR stable_user SERVER ephemeral_workspace
  OPTIONS (user 'ephemeral_abc', password 'generated_pass');
```

Requires a stable PostgreSQL instance in front. Adds query overhead through `postgres_fdw`. Doesn't support all pg_duckdb features natively. Not recommended for this use case.

### Application-Layer Proxy

Custom proxy (e.g., `pgwire` in Rust) that accepts stable creds, looks up ephemeral mapping, and proxies the connection. More flexible but more to build and maintain. PgBouncer already does this.

### pg_ident.conf Peer Mapping

Only works for cert-based or OS-level auth. Not applicable for password-based BI tool connections.

## UI Changes

### Connection Card (Post-Enablement)

The existing `SqlAccessPanel` enabled state shows connection fields. Refinements:

```
+---------------------------------------------------+
| SQL Access: Enabled                        [gear] |
+---------------------------------------------------+
| Host        | sql.dashboard.local          [copy] |
| Port        | 6432                         [copy] |
| Database    | dashboard_external           [copy] |
| Username    | my_project_reader            [copy] |
| Password    | ••••••••••••           [eye] [copy] |
| Schema      | project_abc12345             [copy] |
+---------------------------------------------------+
| Connection String                                 |
| postgresql://my_project_r...@sql... [eye]  [copy] |
+---------------------------------------------------+
| Last synced: 2 minutes ago              [Sync]    |
| [Regenerate Credentials]    [Disable SQL Access]  |
+---------------------------------------------------+
```

- Host/port/database/schema are shown in cleartext (low sensitivity)
- Password is masked by default with eye toggle (existing behavior)
- Connection string is masked by default, revealable
- Copy buttons on each field for easy BI tool setup
- "Regenerate Credentials" rotates the stable password (not the ephemeral one)

### Environment Controls (Below Connection Card)

```
+---------------------------------------------------+
| Environment                                       |
+---------------------------------------------------+
| Name             | Status    | Actions            |
|------------------|-----------|--------------------|
| pgduckdb-abc123  | Running   | [stop] [restart]   |
|                  | (healthy) |                    |
+---------------------------------------------------+
```

States:
- **Running (healthy)** — Green indicator, stop/restart available
- **Running (degraded)** — Yellow indicator, shows warning, restart available
- **Stopped** — Gray indicator, start available
- **Provisioning** — Spinner, no actions
- **Error** — Red indicator, shows error message, retry available

Actions:
- **Start** — Provisions the container (if stopped)
- **Stop** — Deprovisions the container without disabling SQL Access (credentials preserved)
- **Restart** — Stop + Start, credential mapping auto-updates

This is different from Enable/Disable — enabling creates the full setup (credentials, PgBouncer, container), while start/stop only controls the ephemeral container lifecycle.

## Backend Changes

### New Models / Schema

```python
# credential_mapping table (new, in the persistent metadata DB)
class CredentialMapping(Base):
    __tablename__ = "credential_mappings"

    id: Mapped[str]                     # PK
    project_id: Mapped[str]             # FK to projects
    stable_username: Mapped[str]        # User-facing username
    stable_password_hash: Mapped[str]   # bcrypt/scrypt hash of stable password
    ephemeral_username: Mapped[str]     # Current pgduckdb reader role
    ephemeral_password: Mapped[str]     # Current pgduckdb password (encrypted at rest)
    created_at: Mapped[datetime]
    updated_at: Mapped[datetime]
```

### New / Modified Use Cases

| Use Case | Type | Description |
|----------|------|-------------|
| `create_stable_credentials` | New | Generate or accept stable username/password, store mapping |
| `rotate_stable_credentials` | New | Regenerate stable password, update mapping |
| `update_ephemeral_mapping` | New | Called during reconciliation when ephemeral creds change |
| `start_environment` | New | Start container without full enable flow |
| `stop_environment` | New | Stop container without disabling (preserve creds) |
| `get_environment_status` | New | Return container health + status for UI |
| `enable_sql_access` | Modified | Also provisions PgBouncer + creates credential mapping |
| `disable_sql_access` | Modified | Also tears down PgBouncer + deletes credential mapping |
| `reconcile_sql_access` | Modified | Also updates credential mapping after container restart |

### New API Endpoints

```
POST   /api/projects/{id}/sql-access/environment/start
POST   /api/projects/{id}/sql-access/environment/stop
POST   /api/projects/{id}/sql-access/environment/restart
GET    /api/projects/{id}/sql-access/environment/status
```

Existing credential endpoints (`POST .../credentials`) get modified to manage stable credentials instead of ephemeral ones.

## Infrastructure Changes

### PgBouncer Deployment

Option A: **Sidecar per project** — Each project gets its own PgBouncer container. Simple isolation, but more containers.

Option B: **Shared PgBouncer** — Single instance with per-database routing. Fewer resources, but shared failure domain.

Recommendation: Start with Option A (sidecar) for simplicity. The container is ~5MB RAM. Move to shared instance when scale warrants it.

### Docker Compose Addition

```yaml
# Template for per-project PgBouncer sidecar
pgbouncer-{project_id}:
  image: edoburu/pgbouncer:1.22
  environment:
    DATABASE_URL: postgres://admin:secret@pgduckdb-{project_id}:5432/dashboard_external
    AUTH_TYPE: md5
    AUTH_QUERY: "SELECT username, password FROM credential_mapping WHERE stable_username=$1"
  ports:
    - "0:6432"  # Auto-assign host port
  networks:
    - default
  depends_on:
    - pgduckdb-{project_id}
```

### Migration

New Alembic migration for `credential_mappings` table.

## Security Considerations

- Stable passwords are hashed (bcrypt) in the metadata DB — plaintext never stored
- Ephemeral passwords in the mapping table should be encrypted at rest (application-level encryption or DB-level)
- PgBouncer's `auth_query` runs as a privileged user that can read the mapping table
- Connection between PgBouncer and pgduckdb is on the Docker internal network (not exposed)
- Stable credentials are only valid while SQL Access is enabled — disabling deletes the mapping
- Rate limiting on credential regeneration to prevent abuse

## Implementation Order

1. **Environment controls** (start/stop/status) — Decouple container lifecycle from enable/disable
2. **Connection card UI refinements** — Copy buttons, better masking, field sensitivity indicators
3. **Credential mapping model + migration** — Schema for stable ↔ ephemeral mapping
4. **PgBouncer provisioner** — Sidecar container management (mirrors DockerPgDuckDbProvisioner)
5. **Stable credential use cases** — Create, rotate, update mapping
6. **Wire it together** — Update enable/disable/reconcile flows to include PgBouncer + mapping
7. **Frontend integration** — Connect new endpoints to UI

## Dependencies

- PgBouncer Docker image (`edoburu/pgbouncer` or `bitnami/pgbouncer`)
- Existing `DockerPgDuckDbProvisioner` infrastructure
- Existing `SqlAccessPanel` frontend component
- Alembic for migration
- All items in `sql-access-fixes.md` should be resolved first (they are — see that doc)

## Open Questions

- Should the stable username be user-chosen or system-generated? (e.g., `reader_<project_short_id>` vs. user picks a name)
- Should PgBouncer expose a TLS endpoint? (Needed for external access beyond localhost)
- Should we support multiple stable users per project? (e.g., separate read-only and read-write roles for future use)
- Port assignment strategy: auto-assign and store, or use a deterministic mapping?
