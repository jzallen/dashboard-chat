# Design: SQL Access Connection Management

## Architecture Overview

```
BI Tool (Excel / Tableau / Power BI / dbt)
    |
    | stable credentials: reader_a1b2c3d4 / <user-chosen-once password>
    | stable endpoint:    localhost:6433 (allocated from range)
    v
┌──────────────────────────────────────────┐
│  dashboard-pgbouncer-a1b2c3d4            │
│  (persistent sidecar container)          │
│                                          │
│  auth_file: userlist.txt                 │
│    "reader_a1b2c3d4" "md5<hash>"         │
│                                          │
│  [databases]                             │
│    dashboard_external =                  │
│      host=dashboard-pgduckdb-a1b2c3d4    │
│      port=5432                           │
│      dbname=dashboard_external           │
│                                          │
│  pool_mode = session                     │
│  listen_port = 6432                      │
│  max_client_conn = 20                    │
│  default_pool_size = 5                   │
└──────────────┬───────────────────────────┘
               │ upstream connection as reader_a1b2c3d4
               │ using same md5 hash (PgBouncer md5 passthrough)
               v
┌──────────────────────────────────────────┐
│  dashboard-pgduckdb-a1b2c3d4             │
│  (ephemeral, can restart/stop/start)     │
│                                          │
│  role: reader_a1b2c3d4                   │
│  password: md5<hash> (same as above)     │
│  search_path: project_a1b2c3d4           │
│  DuckDB extensions + S3 secrets          │
│                                          │
│  Views:                                  │
│    project_a1b2c3d4.sales_data           │
│    project_a1b2c3d4.inventory            │
└──────────────┬───────────────────────────┘
               │ read_parquet('s3://...')
               v
           MinIO / S3
```

### Key Insight: Single md5 Hash, No Dual Password

The architecture uses a **single md5 PostgreSQL hash** for both authentication layers:

1. **PgBouncer auth_file**: `"reader_a1b2c3d4" "md5<hash>"` — verifies client credentials via md5 challenge-response
2. **pg_duckdb role**: `ALTER ROLE reader_a1b2c3d4 PASSWORD 'md5<hash>'` — same hash set as the PostgreSQL role password

PgBouncer stores the md5 hash from auth_file and uses it for both:
- **Client-side**: md5 challenge-response to authenticate the BI tool
- **Server-side**: md5 challenge-response to authenticate against the upstream pg_duckdb

Since both sides use the same md5 hash of the same password, the connection works end-to-end. When the pg_duckdb container restarts, reconciliation re-creates the role with `ALTER ROLE ... PASSWORD 'md5<hash>'` using the stored hash. No plaintext password is ever stored.

**md5 hash format**: `"md5" + md5(password + username)` — this is PostgreSQL's standard md5 password format.

**Why not bcrypt?** Bcrypt cannot be used by PgBouncer or PostgreSQL for wire-protocol authentication. md5 is required for the PostgreSQL wire protocol challenge-response flow. The security trade-off is acceptable because:
- Passwords are system-generated, 32-character alphanumeric (high entropy)
- The hash includes the username as salt
- The hash is not exposed via any API endpoint
- The database is not publicly accessible

---

## Decision 1: PgBouncer with auth_file (Not auth_query)

### Why Not auth_query

`auth_query` runs against the **upstream database** — the ephemeral pg_duckdb container. This creates problems:

1. **Chicken-and-egg**: When pg_duckdb is stopped, PgBouncer can't authenticate anyone (the query can't run)
2. **Credential storage in ephemeral container**: The mapping table would need to live inside pg_duckdb, which is ephemeral — lost on restart
3. **Startup race**: During pg_duckdb startup, there's a window where auth_query fails

### Why auth_file

`auth_file` is a flat file PgBouncer reads at startup and on SIGHUP/RELOAD:

```
# userlist.txt
"reader_a1b2c3d4" "md5abcdef1234567890abcdef12345678"
```

Benefits:
- Works when the upstream is down (PgBouncer accepts connections, then fails with "server not available" — cleaner error than TCP connection refused)
- No dependency on the ephemeral database for authentication
- Fast to regenerate (write file + SIGHUP)

### Configuration Management

PgBouncer configuration is passed via **environment variables at container creation time**. When config changes (credential rotation, upstream restart), the PgBouncer container is **recreated** rather than reconfigured in-place:

1. Stop old PgBouncer container
2. Create new PgBouncer container with updated env vars + same port binding
3. Start new container

**Why recreation over in-place update?**
- Avoids config file volume management between containers
- PgBouncer starts in ~100ms — sub-second interruption
- Credential rotation is rare (user-initiated)
- Simpler code: no SIGHUP signaling, no docker exec, no shared volumes

The PgBouncer Docker image must support config generation from environment variables. We'll use a minimal custom entrypoint that generates `pgbouncer.ini` and `userlist.txt` from env vars at startup.

---

## Decision 2: Sidecar Per Project

One PgBouncer container per SQL Access-enabled project.

### Why Not Shared Instance

| Factor | Sidecar | Shared |
|--------|---------|--------|
| Isolation | Independent failure domain per project | Single point of failure for all projects |
| Config | Simple (one database, one user) | Complex (multi-database routing, multi-user auth) |
| Lifecycle | Matches existing provisioner pattern | Needs separate management layer |
| Scale | ~5MB RAM each. 100 projects = 500MB | Single container, but config grows linearly |
| Complexity | Low (extend existing provisioner) | Medium (new routing/config management) |

At our current scale (single-team product, likely < 50 active projects), the overhead of sidecar containers is negligible. The shared model only becomes attractive at 500+ projects, which is far beyond current needs.

### Container Naming

Pattern: `dashboard-pgbouncer-{project_id[:8]}`

Mirrors the existing pg_duckdb naming: `dashboard-pgduckdb-{project_id[:8]}`

---

## Decision 3: Sequential Port Allocation

### Port Range

- Default range: `6432–7431` (1000 ports)
- Configurable via settings: `PGBOUNCER_PORT_RANGE_START=6432`, `PGBOUNCER_PORT_RANGE_END=7431`
- Port 6432 is PgBouncer's conventional default

### Allocation Algorithm

```python
async def allocate_proxy_port(session) -> int:
    """Find next available port in the configured range."""
    used_ports = await session.execute(
        select(ExternalAccessRecord.proxy_port)
        .where(ExternalAccessRecord.proxy_port.isnot(None))
    )
    used = {row[0] for row in used_ports}

    for port in range(settings.pgbouncer_port_range_start, settings.pgbouncer_port_range_end + 1):
        if port not in used:
            return port

    raise PortRangeExhausted(
        f"No available ports in range {settings.pgbouncer_port_range_start}-{settings.pgbouncer_port_range_end}"
    )
```

The port is stored in `ExternalAccessRecord` and reused when PgBouncer is recreated or the environment is started/stopped.

### Why Not Dynamic Ports (HostPort: "0")

Dynamic ports defeat the purpose of stable credentials — the connection string changes if the proxy restarts. The whole point of this feature is a stable endpoint.

### Why Not Deterministic Hash

`port = BASE + hash(project_id) % RANGE` risks collisions. Two projects could hash to the same port. Resolution (linear probing, rehashing) adds complexity with no benefit over sequential allocation.

---

## Decision 4: TLS Deferred to Production

**Local dev**: Not needed. All connections are `localhost` or Docker-internal.

**Production path** (documented, not implemented):
- PgBouncer supports `client_tls_sslmode`, `client_tls_cert_file`, `client_tls_key_file`
- Mount cert files into PgBouncer container
- Or terminate TLS at a load balancer in front of PgBouncer
- Add config settings: `PGBOUNCER_TLS_ENABLED`, `PGBOUNCER_TLS_CERT_FILE`, `PGBOUNCER_TLS_KEY_FILE`

---

## Decision 5: md5 Hash Credential Storage

See "Key Insight" section above. Single md5 hash shared between PgBouncer and PostgreSQL.

### Hash Generation

```python
import hashlib

def pg_md5_hash(password: str, username: str) -> str:
    """Generate PostgreSQL md5 password hash."""
    raw = (password + username).encode("utf-8")
    return "md5" + hashlib.md5(raw).hexdigest()
```

### Storage

The `pg_password_hash` column in `ExternalAccessRecord` changes from bcrypt to md5 format:
- **Before**: `$2b$12$...` (bcrypt, 60 chars)
- **After**: `md5abcdef...` (md5, 35 chars: "md5" + 32 hex digits)

This is a **breaking change** for existing records. Handled by the migration strategy (Decision 6).

### Password Generation (Unchanged)

```python
import secrets
import string

def generate_password() -> str:
    alphabet = string.ascii_letters + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(32))
```

---

## Decision 6: Migration via Disable/Re-enable

### Detection

Legacy records are identified by `proxy_container_id IS NULL`:
- New records: have `proxy_container_id`, `proxy_port`, md5 hash format
- Legacy records: have `NULL` proxy fields, bcrypt hash format

### User Experience

When the frontend loads a legacy record:
```
┌─────────────────────────────────────────────────────────┐
│  ⚠ SQL Access needs to be reconfigured                 │
│                                                         │
│  We've upgraded SQL Access to use stable credentials    │
│  that survive environment restarts. Please disable and  │
│  re-enable SQL Access to get your new stable endpoint.  │
│                                                         │
│  [Disable SQL Access]                                   │
└─────────────────────────────────────────────────────────┘
```

### Why Not Background Migration

Background migration would need to:
1. Generate a new password (but who would see it? The user wasn't present)
2. Provision a PgBouncer container per project
3. Handle failures silently

This is fragile and violates the "password shown once" rule (BR-1.5). Disable/re-enable is simpler, gives the user their new password, and uses existing code paths.

---

## Data Model Changes

### ExternalAccessRecord: Modified Columns

```python
# Existing columns (unchanged semantics)
id: Mapped[str]                          # PK, UUIDv7
project_id: Mapped[str]                  # FK projects.id, UNIQUE
org_id: Mapped[str]                      # Multi-tenancy index
pg_schema: Mapped[str]                   # e.g. "project_a1b2c3d4"
pg_role: Mapped[str]                     # e.g. "reader_a1b2c3d4" — this IS the stable username
enabled: Mapped[bool]                    # Soft-disable flag
last_synced_at: Mapped[datetime | None]
created_at: Mapped[datetime]
updated_at: Mapped[datetime]

# Existing columns (changed semantics)
pg_password_hash: Mapped[str]            # NOW: md5 PostgreSQL hash (was bcrypt)
environment_id: Mapped[str | None]       # Docker container ID for pg_duckdb
environment_host: Mapped[str | None]     # NOW: always "localhost" — user-facing proxy host
environment_port: Mapped[int | None]     # NOW: stable proxy port (was dynamic pg_duckdb port)

# NEW columns
proxy_container_id: Mapped[str | None]   # Docker container ID for PgBouncer
environment_status: Mapped[str]          # "running" | "stopped" | "degraded" | "provisioning" | "error"
status_message: Mapped[str | None]       # Human-readable message for degraded/error states
```

### Alembic Migration

```python
# migrations/versions/xxx_add_connection_management.py

def upgrade():
    op.add_column('external_access', sa.Column('proxy_container_id', sa.String(255), nullable=True))
    op.add_column('external_access', sa.Column('environment_status', sa.String(50), server_default='running', nullable=False))
    op.add_column('external_access', sa.Column('status_message', sa.Text(), nullable=True))

def downgrade():
    op.drop_column('external_access', 'status_message')
    op.drop_column('external_access', 'environment_status')
    op.drop_column('external_access', 'proxy_container_id')
```

Note: `environment_host` and `environment_port` already exist. Their semantics change (from pg_duckdb direct to proxy endpoint) but the column type is unchanged. No DDL migration needed for these — the use cases write different values.

---

## Provisioner Architecture

### Extended Protocol

```python
class ProjectEnvironmentProvisioner(Protocol):
    # Existing (unchanged signatures, but now manages both containers)
    async def provision(self, project_id: str, storage_config: StorageConfig) -> ProjectEnvironment: ...
    async def deprovision(self, project_id: str) -> None: ...
    async def health_check(self, project_id: str) -> bool: ...
    async def get_environment(self, project_id: str) -> ProjectEnvironment | None: ...

    # New: lifecycle controls
    async def start_environment(self, project_id: str, storage_config: StorageConfig) -> ProjectEnvironment: ...
    async def stop_environment(self, project_id: str) -> None: ...
    async def get_detailed_status(self, project_id: str) -> EnvironmentStatus: ...
```

### New Data Classes

```python
@dataclass(frozen=True)
class EnvironmentStatus:
    pgduckdb_running: bool
    pgbouncer_running: bool
    status: str          # "running" | "stopped" | "degraded" | "provisioning" | "error"
    message: str | None  # Human-readable detail for non-running states

@dataclass(frozen=True)
class ProjectEnvironment:
    # User-facing (via proxy)
    host: str              # "localhost" in Docker dev
    port: int              # Stable proxy port (e.g. 6433)
    database: str          # "dashboard_external"

    # Internal pg_duckdb
    internal_host: str     # Container name on Docker network
    internal_port: int     # Always 5432
    environment_id: str    # pg_duckdb container ID
    admin_user: str
    admin_password: str

    # Proxy
    proxy_container_id: str  # PgBouncer container ID
```

### DockerPgDuckDbProvisioner Changes

The existing `DockerPgDuckDbProvisioner` is extended (not replaced) to manage PgBouncer:

**`provision()`** — Updated flow:
1. Provision pg_duckdb container (existing logic, unchanged)
2. Allocate proxy port from DB range
3. Create PgBouncer container with:
   - `HostPort: str(proxy_port)` (stable)
   - Env vars: upstream host/port, auth credentials
   - Same Docker network
4. Wait for PgBouncer healthy
5. Return `ProjectEnvironment` with proxy details

**`deprovision()`** — Updated flow:
1. Remove PgBouncer container (new)
2. Remove pg_duckdb container (existing)

**`start_environment()`** — New:
1. Provision pg_duckdb container (same as existing provision, minus PgBouncer)
2. Update PgBouncer config to point to new upstream (recreate PgBouncer with same port)
3. Return `ProjectEnvironment`

**`stop_environment()`** — New:
1. Remove pg_duckdb container only
2. PgBouncer stays running (will return "server not available" to clients)

**`get_detailed_status()`** — New:
1. Check PgBouncer container state
2. Check pg_duckdb container state
3. Return composite status:
   - Both running → "running"
   - PgBouncer running, pg_duckdb down → "stopped"
   - PgBouncer down, pg_duckdb running → "degraded" (proxy failure)
   - Both down → "stopped" or "error"
   - Either starting → "provisioning"

### PgBouncer Container Config

PgBouncer is created with environment variables that a custom entrypoint translates to config files:

```python
pgbouncer_env = {
    # Upstream pg_duckdb connection
    "DB_HOST": f"dashboard-pgduckdb-{project_id[:8]}",
    "DB_PORT": "5432",
    "DB_NAME": "dashboard_external",

    # Auth (stable credentials)
    "AUTH_USER": f"reader_{project_id[:8]}",
    "AUTH_PASSWORD_HASH": pg_md5_hash,  # "md5abcdef..."

    # PgBouncer settings
    "LISTEN_PORT": "6432",       # Internal port (HostPort maps to stable external)
    "POOL_MODE": "session",
    "MAX_CLIENT_CONN": "20",
    "DEFAULT_POOL_SIZE": "5",
    "LOG_CONNECTIONS": "1",
    "LOG_DISCONNECTIONS": "1",
}
```

The entrypoint script generates:

```ini
; /etc/pgbouncer/pgbouncer.ini (generated from env vars)
[databases]
dashboard_external = host=${DB_HOST} port=${DB_PORT} dbname=${DB_NAME}

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = ${LISTEN_PORT}
auth_type = md5
auth_file = /etc/pgbouncer/userlist.txt
pool_mode = ${POOL_MODE}
max_client_conn = ${MAX_CLIENT_CONN}
default_pool_size = ${DEFAULT_POOL_SIZE}
log_connections = ${LOG_CONNECTIONS}
log_disconnections = ${LOG_DISCONNECTIONS}
admin_users = pgbouncer
```

```
; /etc/pgbouncer/userlist.txt (generated from env vars)
"${AUTH_USER}" "${AUTH_PASSWORD_HASH}"
```

### PgBouncer Docker Image

Options (in order of preference):
1. **`edoburu/pgbouncer`** — Popular, supports env-var config via entrypoint
2. **`bitnami/pgbouncer`** — Well-maintained, comprehensive env var support
3. **Custom minimal image** — Alpine + PgBouncer + custom entrypoint

Recommendation: Start with `edoburu/pgbouncer:1.22`. If env var support is insufficient for our auth_file needs, build a minimal custom image (~15MB) with a shell entrypoint.

---

## API Design

### New Endpoints

#### POST /api/projects/{project_id}/sql-access/environment/start

Start a stopped pg_duckdb environment. PgBouncer must already be running (SQL Access enabled).

**Request**: Empty body
**Response 200**:
```json
{
    "project_id": "uuid",
    "environment_status": "running",
    "host": "localhost",
    "port": 6433,
    "database": "dashboard_external"
}
```
**Error 409**: Environment already running
**Error 404**: SQL Access not enabled

#### POST /api/projects/{project_id}/sql-access/environment/stop

Stop the pg_duckdb container. PgBouncer stays running.

**Request**: Empty body
**Response 200**:
```json
{
    "project_id": "uuid",
    "environment_status": "stopped"
}
```
**Error 409**: Environment already stopped
**Error 404**: SQL Access not enabled

#### POST /api/projects/{project_id}/sql-access/environment/restart

Restart the pg_duckdb container (stop + start). Credentials preserved.

**Request**: Empty body
**Response 200**:
```json
{
    "project_id": "uuid",
    "environment_status": "running",
    "host": "localhost",
    "port": 6433,
    "database": "dashboard_external"
}
```
**Error 404**: SQL Access not enabled

#### GET /api/projects/{project_id}/sql-access/environment/status

Get current environment status.

**Response 200**:
```json
{
    "project_id": "uuid",
    "environment_status": "running",
    "status_message": null,
    "pgduckdb_running": true,
    "pgbouncer_running": true
}
```

Possible `environment_status` values: `"running"`, `"stopped"`, `"degraded"`, `"provisioning"`, `"error"`

### Modified Endpoints

#### GET /api/projects/{project_id}/sql-access

Added field:
```json
{
    "project_id": "uuid",
    "enabled": true,
    "host": "localhost",
    "port": 6433,
    "database": "dashboard_external",
    "username": "reader_a1b2c3d4",
    "schema": "project_a1b2c3d4",
    "environment_status": "running",
    "status_message": null,
    "last_synced_at": "2026-02-26T12:00:00Z",
    "created_at": "2026-02-26T11:00:00Z",
    "is_legacy": false
}
```

New fields: `environment_status`, `status_message`, `is_legacy` (true if `proxy_container_id` is null — triggers migration banner).

#### POST /api/projects/{project_id}/sql-access (enable)

Response adds `environment_status: "running"`. Port is now the stable proxy port.

#### POST /api/projects/{project_id}/sql-access/credentials (regenerate)

Unchanged request/response shape. Internally: recreates PgBouncer with new auth_file + updates pg_duckdb role password. Brief sub-second interruption.

Rate limiting: reject if last regeneration was < 60 seconds ago. Return 429 with `Retry-After` header.

---

## Use Case Flows

### Enable SQL Access (Modified)

```
enable_sql_access(project_id):
    1. Validate project ownership + datasets exist (unchanged)
    2. SELECT ... FOR UPDATE on ExternalAccessRecord (unchanged)
    3. Reject if already enabled (unchanged)

    4. Allocate proxy port from range
    5. Generate password (32-char) + compute md5 hash

    6. Provision pg_duckdb container (existing logic)
    7. Create schema + reader role with md5 hash password
    8. Bootstrap views (existing logic)

    9. Create PgBouncer container:
       - Upstream: pg_duckdb internal host:5432
       - Auth: reader_{id8} with md5 hash
       - Port binding: allocated proxy_port
    10. Wait for PgBouncer healthy

    11. Create/update ExternalAccessRecord:
        - environment_host = "localhost"
        - environment_port = proxy_port (stable!)
        - environment_id = pg_duckdb container ID
        - proxy_container_id = PgBouncer container ID
        - pg_password_hash = md5 hash
        - environment_status = "running"

    12. Return connection details + one-time password

    Compensation:
    - If step 9-10 fails: deprovision pg_duckdb, release port, return error
    - If step 6-8 fails: release port, return error (existing compensation)
```

### Disable SQL Access (Modified)

```
disable_sql_access(project_id):
    1. Validate + SELECT FOR UPDATE (unchanged)
    2. Remove PgBouncer container (new)
    3. Remove pg_duckdb container (existing)
    4. soft_disable: clear environment fields + proxy_container_id,
       set environment_status = NULL, free proxy_port
```

### Start Environment (New)

```
start_environment(project_id):
    1. Validate project + SQL Access enabled
    2. Check environment_status != "running"
    3. Set environment_status = "provisioning"

    4. Provision pg_duckdb container (new, with stored password hash)
    5. Create schema + role with md5 hash from DB
    6. Bootstrap views from current datasets
    7. Configure S3 secrets + DuckDB role

    8. Recreate PgBouncer to point to new pg_duckdb container
       (same port binding, updated upstream host)

    9. Update ExternalAccessRecord:
       - environment_id = new container ID
       - environment_status = "running"

    Error handling:
    - If provisioning fails: set environment_status = "error" + status_message
```

### Stop Environment (New)

```
stop_environment(project_id):
    1. Validate project + SQL Access enabled
    2. Check environment_status == "running" or "degraded"

    3. Remove pg_duckdb container
    4. PgBouncer stays running (will refuse connections with upstream error)

    5. Update ExternalAccessRecord:
       - environment_id = NULL
       - environment_status = "stopped"
```

### Restart Environment (New)

```
restart_environment(project_id):
    1. stop_environment(project_id)
    2. start_environment(project_id)
```

### Regenerate Credentials (Modified)

```
regenerate_sql_credentials(project_id):
    1. Validate project + enabled (unchanged)
    2. Check rate limit (new): reject if < 60s since last regeneration

    3. Generate new password + md5 hash
    4. Update pg_duckdb role: ALTER ROLE ... PASSWORD 'md5<new_hash>'
    5. Recreate PgBouncer with new auth_file (new md5 hash)

    6. Update ExternalAccessRecord:
       - pg_password_hash = new md5 hash

    7. Return connection details + one-time new password
```

### Reconciliation (Modified)

```
reconcile_sql_access():
    For each enabled record:
        1. Check PgBouncer container health
        2. Check pg_duckdb container health

        Both running:
            - Re-apply DuckDB role config + S3 secrets (existing)
            - Set status = "running"

        pg_duckdb down, PgBouncer up:
            - Set status = "stopped"
            - Log: container exited

        PgBouncer down, pg_duckdb up:
            - Set status = "degraded", message = "Proxy container stopped unexpectedly"
            - Attempt to recreate PgBouncer

        Both down:
            - Set status = "stopped"
            - Log warning

        Legacy record (proxy_container_id IS NULL):
            - Skip proxy checks
            - Existing behavior for pg_duckdb only
```

---

## Frontend Changes

### SqlAccessPanel Updates

The panel gains two new sections below the existing connection card:

```
┌─────────────────────────────────────────────────────────┐
│ SQL Access                                              │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ● Running                           [Connection Card]  │
│                                                         │
│  Host       │ localhost                          [copy]  │
│  Port       │ 6433                               [copy]  │
│  Database   │ dashboard_external                 [copy]  │
│  Username   │ reader_a1b2c3d4                    [copy]  │
│  Password   │ ••••••••••••••••           [eye]   [copy]  │
│  Schema     │ project_a1b2c3d4                   [copy]  │
│                                                         │
│  Connection String                                      │
│  postgresql://reader_a1b2...    [eye]            [copy]  │
│                                                         │
│  Last synced: 2 min ago                         [Sync]  │
│  [Regenerate Credentials]       [Disable SQL Access]    │
│                                                         │
├─────────────────────────────────────────────────────────┤
│ Environment                                             │
│                                                         │
│  Status: ● Running (healthy)                            │
│  [Stop]  [Restart]                                      │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### New Query Hooks

```typescript
// useSqlAccessQuery.ts additions

export function useEnvironmentStatus(projectId: string) {
    return useQuery({
        queryKey: ["sql-access", projectId, "status"],
        queryFn: () => getEnvironmentStatus(projectId),
        refetchInterval: 15_000,  // 15 seconds when panel is visible
        enabled: !!projectId,
    });
}

export function useStartEnvironment() {
    return useMutation({
        mutationFn: (projectId: string) => startEnvironment(projectId),
        onSuccess: (data) => {
            queryClient.setQueryData(["sql-access", data.project_id], ...);
            queryClient.invalidateQueries(["sql-access", data.project_id, "status"]);
        },
    });
}

export function useStopEnvironment() { /* similar pattern */ }
export function useRestartEnvironment() { /* similar pattern */ }
```

### New API Client Functions

```typescript
// sqlAccess.ts additions
export async function startEnvironment(projectId: string): Promise<SqlAccessStatus> { ... }
export async function stopEnvironment(projectId: string): Promise<SqlAccessStatus> { ... }
export async function restartEnvironment(projectId: string): Promise<SqlAccessStatus> { ... }
export async function getEnvironmentStatus(projectId: string): Promise<EnvironmentStatusResponse> { ... }
```

### Legacy Record Detection

```typescript
// In SqlAccessPanel
if (data.enabled && data.is_legacy) {
    return <LegacyMigrationBanner onDisable={disableMutation.mutate} />;
}
```

---

## Error Handling & Compensation

### Compensation Matrix

| Operation | Failure Point | Compensation |
|-----------|--------------|--------------|
| Enable | pg_duckdb provision fails | Release port, return error |
| Enable | Schema/role creation fails | Deprovision pg_duckdb, release port |
| Enable | PgBouncer creation fails | Deprovision pg_duckdb, release port |
| Start | pg_duckdb provision fails | Set status = "error" + message |
| Start | PgBouncer recreation fails | Set status = "degraded" + message |
| Stop | pg_duckdb removal fails | Log warning, attempt force-remove |
| Regenerate | ALTER ROLE fails | Keep old credentials, return error |
| Regenerate | PgBouncer recreation fails | Roll back ALTER ROLE (restore old hash), return error |

### Graceful Degradation

- **Status polling network errors**: Frontend shows last-known status with staleness indicator ("Last checked: 2 min ago")
- **PgBouncer accepts but upstream down**: Client gets clean PostgreSQL error "connection to server failed" (not TCP timeout)
- **Rate-limited regeneration**: 429 response with `Retry-After: 60` header

---

## Configuration

### New Settings (backend/app/config.py)

```python
# PgBouncer
pgbouncer_image: str = "edoburu/pgbouncer:1.22"
pgbouncer_port_range_start: int = 6432
pgbouncer_port_range_end: int = 7431
pgbouncer_max_client_conn: int = 20
pgbouncer_default_pool_size: int = 5

# Credential management
credential_regen_cooldown_seconds: int = 60
```

### Docker Compose Changes

No static PgBouncer service in docker-compose.yml (like pg_duckdb, they are created dynamically). But the API container needs new env vars:

```yaml
dashboard-api:
  environment:
    # ... existing vars ...
    PGBOUNCER_IMAGE: edoburu/pgbouncer:1.22
    PGBOUNCER_PORT_RANGE_START: "6432"
    PGBOUNCER_PORT_RANGE_END: "7431"
```
