## Context

Dashboard Chat stores dataset data as hive-partitioned Parquet in MinIO/S3 and queries it via DuckDB + Ibis for in-browser table previews. An existing dbt export feature (`export_dbt_project.py`) generates a self-contained dbt project targeting in-memory DuckDB, with staging models that apply the user's transforms (clean, filter, alias) as CTE pipelines.

Users need to connect external tools (Excel/ODBC, Power BI, Tableau, dbt CLI) to query the same data. These tools speak SQL over a wire protocol -- they can't consume Parquet from S3 directly.

The approach: launch an **ephemeral, per-project pg_duckdb container** when a user enables SQL access. The container runs PostgreSQL 16 with the `pg_duckdb` extension, which embeds DuckDB's analytical engine inside Postgres and supports `read_parquet('s3://...')` from standard SQL. The backend bootstraps the container with views and dbt models, then returns dynamic connection details. When the user disables SQL access, the container is torn down. A **provisioner abstraction** manages container lifecycle, allowing the Docker implementation (local dev) to be swapped for a cloud container service (production) without changing use case code.

### Current State

**Data flow (unchanged by this change):**
```
CSV upload -> Parquet in S3 -> DuckDB/Ibis queries -> JSON preview rows -> Frontend
```

**Existing dbt generators** (`backend/app/use_cases/project/dbt/`):
- `profiles_yml.py` -- DuckDB target with S3 env_var placeholders
- `sources_yml.py` -- Maps datasets to S3 paths via `external_location` meta
- `model_sql.py` -- CTE pipeline per dataset: `source -> cleaned -> filtered -> SELECT aliases`
- `macros_sql.py` -- DuckDB UDFs: `title_case()`, `snake_case()`, `kebab_case()`
- `schema_yml.py`, `project_yml.py`, `readme.py`, `naming.py`
- `__init__.py` -- Orchestrator: `generate_dbt_project_zip(project, name_snake)`

**Key reuse points:**
- `Dataset.storage_path` -> `datasets/{project_id}/{dataset_id}/` (S3 prefix for Parquet)
- `MinIOLakeRepository._configure_duckdb_s3()` -> S3 connection params from `Settings`
- `generate_sources_yml(project_name_snake, datasets)` -> dataset-to-source mapping
- `generate_model_sql(dataset, source_name, project_name)` -> transform CTE pipeline

## Goals / Non-Goals

**Goals:**
- External tools connect via standard PostgreSQL wire protocol and query datasets with SQL
- Transforms (filter, clean, alias) applied in the dashboard are reflected in external query results
- Per-project isolation -- each project gets its own ephemeral pg_duckdb container
- Ephemeral lifecycle -- containers exist only while SQL access is enabled, torn down on disable
- Provisioner abstraction -- infrastructure-agnostic interface for container management (Docker locally, cloud in production)
- The exported dbt project is self-contained: an engineer can `psql -f bootstrap_db.sql` + `dbt run --target postgres` against their own pg_duckdb instance
- Read-only access -- no mutations through the external connection
- Web UI data path (DuckDB + Ibis) is completely unchanged

**Non-Goals:**
- Write-back from external tools to dashboard datasets
- Auto-sync on every dataset mutation (Phase 2 -- manual "Sync" for now)
- Production-grade HA / connection pooling (PgBouncer, RDS) -- this is the local/staging architecture
- Real-time streaming of changes to connected BI tools
- dbt execution inside the container (backend runs dbt externally for simplicity)
- Warm container pools or pre-provisioning (synchronous launch is acceptable at current scale)

## Decisions

### D1: dbt project as the schema definition layer

The dbt project -- not raw DDL -- defines what's queryable in Postgres. The bootstrap script creates source views, dbt models create staging/mart views on top.

```
Dataset metadata
      |
  bootstrap_db.sql          CREATE VIEW src AS SELECT * FROM read_parquet('s3://...')
      |
  dbt sources.yml           Declares bootstrap views as dbt sources
      |
  dbt staging models        CTE pipeline: source -> cleaned -> filtered -> aliases
      |
  dbt run --target postgres
      |
  Queryable views in pg_duckdb
```

**Why not raw DDL (CREATE VIEW with full transform SQL)?**
- The staging model SQL already exists and is tested -- `model_sql.py` generates correct CTE pipelines for all transform combinations
- dbt manages schema lifecycle (create, replace, drop) -- no custom DDL state tracking
- The same project works for both DuckDB (standalone analysis) and Postgres (live connectivity)
- Future upgrade to RDS: swap `read_parquet()` views for tables, change materialization -- models unchanged

**Alternative: generate Postgres views directly from `Dataset.staging_sql`.**
Rejected because `staging_sql` is Ibis-generated with hardcoded S3 paths -- it works for one-shot preview queries but doesn't compose with dbt's source abstraction, materialization control, or project portability.

### D2: Ephemeral container-per-project with provisioner abstraction

> **Revised from original design.** Previously: shared pg_duckdb instance with schema-per-project. Now: one ephemeral container per project, managed by a provisioner protocol.

Each project that enables SQL access gets its own pg_duckdb container. The container is launched on enable and torn down on disable.

**Container lifecycle:**
```
enable_sql_access()
  |-> provisioner.provision(project_id, storage_config)
  |     |-> Docker: create container from pgduckdb image
  |     |-> Attach to Docker network (for MinIO access)
  |     |-> Map random host port -> 5432
  |     |-> Wait for pg_isready health check
  |     \-> Return ProjectEnvironment { host, port, environment_id }
  |-> configure S3 secrets via admin SQL
  |-> create schema + role (pg_duckdb_manager)
  |-> execute bootstrap SQL + dbt run
  \-> store ProjectEnvironment in ExternalAccessRecord

disable_sql_access()
  |-> provisioner.deprovision(project_id)
  |     |-> Docker: stop + remove container
  |     \-> Release mapped port
  \-> soft-disable ExternalAccessRecord
```

**Why container-per-project (not shared instance)?**
1. The original backlog specifies "workspace-scoped lifecycle: spin up on open, tear down on close"
2. A shared instance must always be running -- contradicts ephemeral intent
3. Container-per-project gives true resource isolation (memory, CPU), not just schema isolation
4. Clean teardown -- no orphan schemas, roles, or DuckDB engine state
5. Dynamic provisioning supports future cloud deployment (ECS, Cloud Run) without redesign
6. Each container is lightweight (~50-100MB base memory; DuckDB engine ~256MB per connection)

**When to revisit:** If container startup latency (5-10s) becomes a UX bottleneck, consider a warm pool. If concurrent project count exceeds ~10, consider org-scoped containers with schema isolation. The provisioner abstraction makes these transitions possible without rewriting use cases.

### D3: Dual-target dbt profiles with target-aware sources

The exported dbt project gains a second target in `profiles.yml`:

```yaml
project_name:
  target: dev
  outputs:
    dev:                              # Existing: standalone DuckDB
      type: duckdb
      path: ":memory:"
      extensions: [httpfs]
      settings:
        s3_access_key_id: "{{ env_var('S3_ACCESS_KEY_ID') }}"
        s3_secret_access_key: "{{ env_var('S3_SECRET_ACCESS_KEY') }}"
        s3_endpoint: "{{ env_var('S3_ENDPOINT', '') }}"
        s3_url_style: "{{ env_var('S3_URL_STYLE', 'vhost') }}"
        s3_region: "{{ env_var('S3_REGION', 'us-east-1') }}"
    postgres:                         # New: live pg_duckdb connection
      type: postgres
      host: "{{ env_var('PG_HOST', 'localhost') }}"
      port: "{{ env_var('PG_PORT', '5433') }}"
      user: "{{ env_var('PG_USER') }}"
      password: "{{ env_var('PG_PASSWORD') }}"
      dbname: "{{ env_var('PG_DATABASE', 'dashboard_external') }}"
      schema: "{{ env_var('PG_SCHEMA', 'public') }}"
```

**Sources resolution** depends on target:
- **DuckDB target** (existing): `external_location` meta on source tables -> DuckDB reads Parquet directly from S3
- **Postgres target** (new): no `external_location` -- sources resolve to bootstrap views already created by `bootstrap_db.sql`

Since `external_location` is a dbt-duckdb-specific feature that Postgres ignores, the same `sources.yml` works for both targets without conditional logic.

**Staging models are identical for both targets.** The `{{ source('project', 'dataset') }}` macro resolves differently per adapter, but the CTE pipeline SQL is the same. DuckDB functions used in transforms (`TRIM`, `UPPER`, `COALESCE`, `CASE`) work in pg_duckdb because it routes queries through DuckDB's engine.

### D4: Bootstrap SQL generator alongside existing generators

File: `backend/app/use_cases/project/dbt/bootstrap_sql.py` (already implemented)

```python
def generate_bootstrap_sql(
    schema_name: str,
    datasets: list[tuple[str, Dataset]],
    bucket: str,
) -> str:
```

Generates:
```sql
BEGIN;
CREATE SCHEMA IF NOT EXISTS {schema_name};

-- Drop existing views (idempotent cleanup)
DO $$ ... DROP VIEW IF EXISTS ... END $$;

CREATE OR REPLACE VIEW {schema_name}.{dataset_snake} AS
  SELECT * FROM read_parquet('s3://{bucket}/{dataset.storage_path}**/*.parquet');
-- repeated per dataset

COMMIT;
```

This reuses `Dataset.storage_path` and `to_snake_case()` from existing `naming.py`. The bootstrap script is included in the exported ZIP at `scripts/bootstrap_db.sql` and also executed by the backend when enabling/syncing SQL access.

### D5: Backend runs bootstrap + dbt externally against the container

> **Clarified from original design.** The container is a pure database server. The backend runs all SQL and dbt operations against the container's exposed port.

**Why backend-external, not container-internal?**
- Standard `pgduckdb/pgduckdb:16-main` image -- no custom Dockerfile to maintain
- Backend already has dbt generators and can install `dbt-core` + `dbt-postgres` as CLI dependencies
- No need for `docker exec`, file mounting, or SSH into the container
- Easier debugging -- dbt runs in a known Python environment with captured stdout/stderr

**Execution flow for enable/sync:**
1. Provisioner returns `ProjectEnvironment` with `host:port`
2. Backend connects via asyncpg to `env.host:env.port` as admin
3. Backend executes S3 secret configuration SQL (parameterized from `Settings`)
4. Backend executes bootstrap SQL (CREATE VIEWs over `read_parquet()`)
5. Backend writes dbt project to temp dir with container's connection details
6. Backend runs `dbt run --target postgres --project-dir {tmpdir} --profiles-dir {tmpdir}` via subprocess
7. Cleanup temp dir, update `last_synced_at`

**dbt CLI dependencies:** `dbt-core` + `dbt-postgres` are added to the backend's `pyproject.toml` as runtime dependencies. They're invoked via subprocess (CLI contract), not Python API.

### D6: Manual sync with explicit user action

"Sync" is a button click, not automatic. When clicked:
1. Regenerate bootstrap SQL from current dataset metadata
2. Re-run bootstrap + dbt against the project's container
3. New datasets appear, removed datasets' views are dropped, updated transforms rebuild

**Why not auto-sync?**
- Avoids surprise schema changes for connected BI tools mid-session
- Simpler implementation -- no event consumer, no background worker
- The outbox already captures `DatasetUpdated` events, so auto-sync is a clean Phase 2 addition

**Sync semantics:** The bootstrap pipeline drops all views in the schema and recreates from scratch, wrapped in a transaction. Connected tools see either the old or new schema, never empty.

### D7: Credential lifecycle

**On enable:**
1. Generate `short_id` = first 8 chars of project UUID (collision-safe -- one container per project)
2. `CREATE ROLE reader_{short_id} LOGIN PASSWORD '{random_32_char}' CONNECTION LIMIT 3`
3. `GRANT USAGE ON SCHEMA project_{short_id} TO reader_{short_id}`
4. `ALTER ROLE reader_{short_id} SET search_path TO project_{short_id}`
5. Store `ExternalAccess(project_id, pg_schema, pg_role, bcrypt(password), environment_id, environment_host, environment_port, enabled=True)` in metadata DB
6. Return plaintext password + dynamic connection details to frontend (one-time display)

**On disable:**
1. Provisioner deprovisions the environment (all schemas, roles, connections destroyed with it)
2. Update `ExternalAccess.enabled = False`, clear environment fields in metadata DB

**On regenerate credentials:**
1. `ALTER ROLE reader_{short_id} PASSWORD '{new_random}'` (via admin connection to the project's container)
2. Update hash in metadata DB
3. Return new plaintext password (one-time display)

Passwords are never stored in plaintext server-side. The frontend displays them once on create/regenerate with a copy button and a warning.

### D8: Provisioner abstraction (NEW)

The provisioner is a protocol that decouples use case logic from infrastructure:

```python
@dataclass
class ProjectEnvironment:
    environment_id: str     # Opaque infrastructure ID (Docker container ID, ECS task ARN, etc.)
    host: str               # Connection host (localhost for Docker, hostname for cloud)
    port: int               # Mapped port for connections
    database: str           # Database name ("dashboard_external")
    admin_user: str         # Admin role for DDL operations
    admin_password: str     # Admin password

@dataclass
class StorageConfig:
    endpoint: str           # "minio:9000" (internal) or S3 endpoint
    access_key: str
    secret_key: str
    region: str
    url_style: str          # "path" for MinIO, "vhost" for S3
    use_ssl: bool

class ProjectEnvironmentProvisioner(Protocol):
    async def provision(self, project_id: str, storage_config: StorageConfig) -> ProjectEnvironment:
        """Provision a project SQL environment.
        Waits for health check. Configures storage secrets.
        Raises ProvisioningError on failure."""
        ...

    async def deprovision(self, project_id: str) -> None:
        """Tear down the project's SQL environment.
        Idempotent -- no error if environment doesn't exist."""
        ...

    async def health_check(self, project_id: str) -> bool:
        """Check if the project's environment is running and accepting connections."""
        ...

    async def get_environment(self, project_id: str) -> ProjectEnvironment | None:
        """Get connection info for a running environment. None if not running."""
        ...
```

**DockerPgDuckDbProvisioner (local dev implementation):**
- Uses `aiodocker` (async Docker API client) for container lifecycle
- Image: configurable, defaults to `pgduckdb/pgduckdb:16-main`
- Port allocation: Docker auto-assigns host port via `0:5432` mapping
- Networking: Container joins `pg_duckdb_network` (configurable, defaults to the Compose default network) so it can reach MinIO via internal hostname
- Container naming: `dashboard-pgduckdb-{project_short_id}`
- Health check: Polls `pg_isready` via Docker exec or TCP connect, with timeout
- S3 secrets: Configured post-launch via admin SQL (`CREATE SECRET` using pg_duckdb's DuckDB API)
- Cleanup: Containers are force-removed on teardown (no persistent data needed)

**Future cloud implementation (not in scope):**
- `ECSProvisioner`, `CloudRunProvisioner`, etc.
- Same protocol, different infrastructure
- Container info includes cloud-specific routing (ALB, Cloud Run URL, etc.)

### D9: Dynamic connection details and data model (NEW)

Connection host/port are no longer static configuration. They're outputs of the provisioner, stored in the `ExternalAccessRecord`.

**Config changes:**

| Setting | Status | Notes |
|---------|--------|-------|
| `pg_duckdb_host` | **Removed** | Now dynamic per-container |
| `pg_duckdb_port` | **Removed** | Now dynamic per-container |
| `pg_duckdb_external_host` | **Removed** | Now dynamic per-container |
| `pg_duckdb_external_port` | **Removed** | Now dynamic per-container |
| `pg_duckdb_admin_user` | **Kept** | Standardized across containers |
| `pg_duckdb_admin_password` | **Kept** | Standardized across containers |
| `pg_duckdb_database` | **Kept** | Standardized across containers |
| `pg_duckdb_image` | **New** | Docker image for pg_duckdb containers |
| `pg_duckdb_network` | **New** | Docker network to join (for MinIO access) |
| `environment_provisioner` | **New** | Provisioner implementation: `"docker"` or `"mock"` |

**Data model extensions (ExternalAccessRecord):**

| Field | Type | Purpose |
|-------|------|---------|
| `environment_id` | String(255), nullable | Opaque infrastructure ID (Docker container ID, ECS task ARN, etc.) |
| `environment_host` | String(255), nullable | Connection host for end-users |
| `environment_port` | Integer, nullable | Connection port for end-users |

These fields are populated on enable, read by `get_sql_access`, and cleared on disable.

**API response** (get_sql_access):
```json
{
  "project_id": "...",
  "enabled": true,
  "host": "localhost",
  "port": 32771,
  "database": "dashboard_external",
  "username": "reader_a1b2c3d4",
  "schema": "project_a1b2c3d4",
  "last_synced_at": "2026-02-22T12:34:56Z"
}
```

### D10: pg_duckdb manager refactored as stateless service (NEW)

The existing `pg_duckdb_manager.py` contains correct DDL logic but connects using static config. It's refactored to accept `ProjectEnvironment` as a parameter:

```python
# Before: reads from Settings (static)
async def create_project_schema(project_id: str, password: str) -> None:
    conn = await asyncpg.connect(
        host=settings.pg_duckdb_host,  # static!
        port=settings.pg_duckdb_port,  # static!
        ...
    )

# After: accepts ProjectEnvironment (dynamic)
async def create_project_schema(
    env: ProjectEnvironment,
    project_id: str,
    password: str,
) -> None:
    conn = await asyncpg.connect(
        host=env.host,
        port=env.port,
        user=env.admin_user,
        password=env.admin_password,
        database=env.database,
    )
```

All DDL functions (`create_project_schema`, `drop_project_schema`, `execute_bootstrap`, `grant_schema_usage`, `regenerate_credentials`) gain an `env: ProjectEnvironment` parameter. The functions remain stateless -- each call creates and closes its own connection.

**Why keep schema-per-project inside per-project containers?**
- Consistent code path whether instance topology changes later
- Reader role still needs `search_path` restriction (defense in depth)
- Schema name appears in connection strings and user-facing docs
- Minimal cost for maximum safety

## Component Architecture

```
Frontend                          Backend API
  |                                  |
  | POST /sql-access                 |
  |--------------------------------->|
  |                                  |
  |                          enable_sql_access()
  |                                  |
  |                    +-------------+-------------+
  |                    |                           |
  |          ProjectEnvironment-         PgDuckDbManager
  |          Provisioner (Protocol)      (DDL Service)
  |                    |                           |
  |          DockerPgDuckDb-                       |
  |          Provisioner (impl)                    |
  |                    |                           |
  |             +------+------+                    |
  |             |             |                    |
  |        Docker API    pg_duckdb                 |
  |        (aiodocker)   container                 |
  |                    5432->{port}                 |
  |                          |                     |
  |                          +------asyncpg--------+
  |                          |
  |                    ExternalAccessRepo
  |                    (metadata DB)
  |                          |
  | <-- { host, port, creds } --|
```

**Dependency graph:**
```
Use Case (enable/disable/sync/get/regenerate)
    |
    +-> ProjectEnvironmentProvisioner (environment lifecycle)
    |     +-> DockerPgDuckDbProvisioner (local: aiodocker)
    |     +-> MockEnvironmentProvisioner (tests)
    |
    +-> PgDuckDbManager (DDL operations against a ProjectEnvironment)
    |     +-> asyncpg (admin connections)
    |
    +-> BootstrapSqlGenerator (view DDL)
    +-> DbtProjectGenerator (staging models)
    +-> ExternalAccessRepository (metadata persistence)
```

## Risks / Trade-offs

**[Environment provisioning latency]** -- Provisioning a project environment takes ~5-10 seconds (Docker image pull cached, container init + health check). The `enable_sql_access` call is synchronous.
*Mitigation:* Frontend shows a loading indicator ("Provisioning database..."). The latency is a one-time cost per enable. If problematic at scale, add a warm pool behind the same `ProjectEnvironmentProvisioner` interface.

**[Docker dependency on backend]** -- The backend needs access to the Docker socket (or Docker API) to manage containers. This adds an infrastructure coupling.
*Mitigation:* `ProjectEnvironmentProvisioner` isolates the coupling. `MockEnvironmentProvisioner` for tests, `DockerPgDuckDbProvisioner` for dev, cloud provisioner for production. Use case code never imports `aiodocker` -- only the concrete provisioner does.

**[Port exhaustion]** -- Each container maps a random host port. With many concurrent projects, port space could theoretically run out.
*Mitigation:* Docker ephemeral port range is 32768-60999 (~28K ports). Even 100 concurrent containers use <0.4%. Connection limit of 3 per role further bounds resource usage.

**[Orphan cleanup on crash]** -- If the backend crashes mid-provision, orphan containers may remain.
*Mitigation:* Container naming convention (`dashboard-pgduckdb-{short_id}`) allows periodic cleanup. A startup reconciliation step compares running containers against `ExternalAccessRecord` entries and deprovisions orphans. Add this as a Phase 2 improvement.

**[pg_duckdb maturity]** -- pg_duckdb v1.0 is recent. S3 secret management and `read_parquet()` in views may have edge cases.
*Mitigation:* Pin to a tested version. Bootstrap SQL is simple (one function call per view). Add integration tests that verify round-trip: bootstrap -> dbt run -> SELECT.

**[Memory per container]** -- Each pg_duckdb container uses ~50-100MB base, plus ~256MB per active DuckDB connection (spawned on each Postgres connection).
*Mitigation:* `CONNECTION LIMIT 3` per role caps at ~768MB per project. With 5 active projects = ~4GB total. Acceptable for dev/staging. Production would use right-sized cloud containers.

**[DuckDB macro compatibility in pg_duckdb]** -- Custom macros (`title_case`, `snake_case`, `kebab_case`) may need registration via `duckdb.raw_query()` in pg_duckdb.
*Mitigation:* Test macro registration during bootstrap. If needed, add a macro registration step to the bootstrap pipeline.

**[S3 secrets per environment]** -- Each project environment needs its own S3 secret configuration (no shared state between environments).
*Mitigation:* Provisioner configures S3 secrets as part of the provision sequence, using the MinIO/S3 credentials from `StorageConfig`. This is a single SQL statement per environment.

## Migration Plan

### From Current Implementation to Ephemeral Architecture

The existing code implements the "shared instance" model. Migration to ephemeral containers proceeds in phases, with each phase independently deployable.

**Phase 1 -- Provisioner Abstraction (no behavior change for existing tests):**
1. Define `ProjectEnvironmentProvisioner` protocol and `ProjectEnvironment` dataclass
2. Implement `MockEnvironmentProvisioner` for tests (returns hardcoded ProjectEnvironment)
3. Refactor `pg_duckdb_manager.py` -- all functions accept `env: ProjectEnvironment` parameter instead of reading from `Settings`
4. Update use cases to get ProjectEnvironment from provisioner (via MockEnvironmentProvisioner in tests)
5. Add `environment_id`, `environment_host`, `environment_port` columns to `external_access` (Alembic migration)
6. Update config: add `pg_duckdb_image`, `pg_duckdb_network`, `environment_provisioner`; deprecate static host/port

**Phase 2 -- DockerPgDuckDbProvisioner (local dev):**
1. Implement `DockerPgDuckDbProvisioner` using `aiodocker`
2. Add `aiodocker` to backend dependencies
3. Update docker-compose.yml: remove static `pg-duckdb` service, add Docker socket mount for api service
4. Integration test: enable -> connect -> query -> sync -> disable -> verify container removed
5. Add startup reconciliation: clean orphan containers on backend startup

**Phase 3 -- Frontend + API (mostly unchanged from original plan):**
1. Frontend reads dynamic host/port from API response (not hardcoded)
2. Connection details panel shows container status
3. Enable/disable trigger provisioner through existing API endpoints

**Phase 4 -- dbt Export Integration:**
1. Include `scripts/bootstrap_db.sql` in exported ZIP
2. Update README with pg_duckdb setup instructions
3. Verify exported project runs against external pg_duckdb

**Rollback:** Disable the feature -> all environments are deprovisioned via `provisioner.deprovision()`. Metadata table records remain (soft disabled). No impact on other services.

## Open Questions

1. **Docker socket access** -- The backend container needs access to `/var/run/docker.sock` to manage containers. Is this acceptable for the dev container setup? For production, the cloud provisioner avoids this.

2. **S3 secret persistence across connections** -- In pg_duckdb, does `CREATE SECRET` persist across new connections to the same container, or is it per-connection? If per-connection, bootstrap SQL needs to include S3 secret setup. Initial testing suggests it persists within the DuckDB catalog (container-scoped).

3. **dbt-duckdb `external_location` behavior in Postgres adapter** -- We assume the Postgres adapter ignores the `external_location` meta key in `sources.yml`. Need to verify this doesn't cause a dbt compilation error.

4. **aiodocker vs docker-py** -- `aiodocker` is async-native (fits FastAPI), but `docker-py` has a larger community. Need to evaluate maturity and maintenance status of both. Preliminary recommendation: `aiodocker` for consistency with the async stack.

5. **Container resource limits** -- Should provisioned containers have CPU/memory limits set via Docker? Recommended: set `mem_limit: 1g` and `cpus: 1.0` per container to prevent runaway resource usage.
