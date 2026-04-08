## Context

SQL access currently uses per-project ephemeral pg_duckdb containers with PgBouncer sidecars. Each enable/disable cycle provisions/deprovisions containers, producing dynamic connection details. The backend also runs analytical queries (previews, row counts, cleaning) in-process via `duckdb_factory.py`, sharing memory/CPU with HTTP request handling.

The outbox pattern already exists in the codebase (`OutboxRepository` with `UploadFileReceived`, `TransformsCreated`, `TransformsUpdated` events). The provisioner protocol (`ProjectEnvironmentProvisioner`) abstracts container lifecycle. Schema/role management (`pg_duckdb_manager.py`) creates per-project schemas and roles via asyncpg against a target connection.

The proposal calls for replacing this with org-level persistent query engine nodes that act as thin access layers over the data lake, with event-driven sync from the catalog and obfuscated credentials.

## Goals / Non-Goals

**Goals:**
- Replace in-process DuckDB with network queries to the query engine for all backend analytical operations (previews, row counts, column inspection, cleaning previews)
- Replace per-project container provisioning with schema/role lifecycle management in a shared engine
- Introduce event-driven sync so dataset creation, transform changes, and deletions propagate to the engine automatically
- Introduce an org-level `QueryEngineNode` data model with 1:many org relationship
- Decouple user-facing credentials from internal PostgreSQL roles so rotation doesn't rebuild permission scaffolding
- Add frontend engine list/detail views and rework the project SQL access panel as a permissions/sync page
- Support displaying multiple engine nodes per org (data model and UI) without implementing multi-node orchestration

**Non-Goals:**
- Multi-node orchestration, load balancing, or engine deployment automation
- Replacing the outbox pattern with a message queue (use existing outbox + polling)
- Migrating existing per-project containers automatically (manual migration path is acceptable)
- Auto-sync without the outbox (no DB triggers or CDC)
- Internal web app query routing optimization (connection pooling tuning deferred)

## Decisions

### D1: Query engine as a docker-compose sidecar service

**Decision:** Add a single `query-engine` service to docker-compose using the `pgduckdb/pgduckdb` image, configured with S3 credentials at startup. The backend connects to it via asyncpg for all analytical queries.

**Why over alternatives:**
- *Kubernetes sidecar / ECS task*: Premature — the platform runs on Docker Compose today. The provisioner protocol abstraction already supports swapping implementations later.
- *In-process DuckDB with resource limits*: Doesn't solve the security boundary problem (bypassed SQL validation = RCE). Network boundary is the only reliable isolation.
- *Separate PostgreSQL + FDW to DuckDB*: Adds complexity without benefit — pg_duckdb already provides PostgreSQL wire protocol natively.

**Implications:** The `query-engine` service is always-on, started with `docker compose up`. Init script loads httpfs, configures S3 secrets, creates the `duckdb_readers` group role. Backend no longer needs Docker socket access.

### D2: Outbox-driven event sync for dataset/transform propagation

**Decision:** Extend the existing outbox pattern with new event types (`DatasetSyncRequested`, `TransformSyncRequested`, `DatasetRemoved`). A sync processor polls `get_unprocessed()` events and executes the corresponding `CREATE OR REPLACE VIEW` / `DROP VIEW` statements against the query engine.

**Why over alternatives:**
- *Direct sync in request path*: Couples the upload/transform API response time to engine availability. If the engine is slow or down, the user's upload fails.
- *Message queue (Redis pub/sub, RabbitMQ)*: The outbox already exists and provides at-least-once delivery with replay. Adding a queue introduces a new dependency without proportional benefit at current scale.
- *DB triggers / CDC*: Requires PostgreSQL-specific setup, doesn't work with SQLite dev mode, and is harder to test.

**Implications:** The sync processor runs as a background task in the backend (asyncio task started on app startup). It polls the outbox on a short interval (e.g., 1-2 seconds) and processes events in batch. Failed events are retried with backoff. The project permissions page shows per-dataset sync status derived from outbox state (unprocessed = pending, processed = synced, failed = error).

### D3: Simplified provisioner protocol — schema/role lifecycle only

**Decision:** Replace `ProjectEnvironmentProvisioner` with a `QueryEngineProvisioner` that only manages schema/role lifecycle:
- `create_project_access(engine_node_id, project_id, password)` → creates schema + role
- `drop_project_access(engine_node_id, project_id)` → drops schema + role
- `sync_views(engine_node_id, project_id, bootstrap_sql)` → executes bootstrap SQL
- `health_check(engine_node_id)` → checks engine reachability

**Why over alternatives:**
- *Keep full provisioner protocol*: Most methods (`provision`, `deprovision`, `start_environment`, `stop_environment`) are no longer needed — the engine is always running. Keeping them adds dead code.
- *No provisioner abstraction*: Hardcoding asyncpg calls throughout use cases makes testing harder and prevents swapping engine implementations later.

**Implications:** `docker_provisioner.py`, `pgbouncer_provisioner.py`, and `port_allocation.py` are removed. `pg_duckdb_manager.py` is retained and adapted — it already does the schema/role work. The enable/disable use cases simplify to calling the provisioner for schema/role creation/deletion + catalog record management.

### D4: QueryEngineNode data model with org-level ownership

**Decision:** New `QueryEngineNode` model:
- `id`, `org_id`, `name`, `host`, `port`, `database`, `admin_user`, `admin_password_encrypted`, `status`, `status_message`, `created_at`, `updated_at`
- Unique constraint on `(org_id, name)`
- Indexed on `org_id`

The `ExternalAccessRecord` gains a `engine_node_id` foreign key, replacing `environment_id`, `environment_host`, `environment_port`. Connection details are derived from the engine node, not stored per-project.

**Why over alternatives:**
- *Reuse ExternalAccessRecord with shared environment fields*: Conflates project-level access with org-level engine topology. Multiple projects sharing an engine would duplicate host/port values, making updates error-prone.
- *Config-only (no model)*: Can't support multiple nodes per org, can't track status per node, can't show engine list in the UI.

**Implications:** Alembic migration adds `query_engine_nodes` table and `engine_node_id` FK on `external_access`. Existing records need migration (create a default node from settings, backfill FK). The frontend queries a new `/api/query-engines` endpoint for the list view.

### D5: Obfuscated credentials via proxy role pattern

**Decision:** Each project gets two PostgreSQL roles:
1. **Internal role** (`reader_{short_id}`) — owns the schema grants, search_path, `duckdb_readers` membership. Never exposed to users. Password is system-managed.
2. **Proxy role** (`proxy_{short_id}`) — the role users authenticate as. Has `SET ROLE reader_{short_id}` privilege. Password is what the user sees and can regenerate.

Regenerating credentials = `ALTER ROLE proxy_{short_id} PASSWORD '...'`. The internal role, schema grants, and `duckdb_readers` membership are untouched.

**Why over alternatives:**
- *PgBouncer auth_file rotation*: Requires PgBouncer reload/restart and a sidecar process. Adds operational complexity.
- *Single role with password change*: Works, but credential rotation temporarily breaks active connections AND forces re-grant if the role is dropped/recreated. The proxy pattern cleanly separates auth from authorization.
- *Token-based auth (e.g., JWT → PostgreSQL)*: Requires custom PostgreSQL auth plugin or middleware. Non-standard for BI tool compatibility.

**Implications:** `pg_duckdb_manager.py` gains `create_proxy_role()` and `regenerate_proxy_credentials()` functions. The `ExternalAccessRecord` stores the proxy role name and password hash (not the internal role password). Connection strings use the proxy role credentials.

### D6: Backend analytical queries via asyncpg connection pool to engine

**Decision:** Replace `duckdb_factory.py` (in-process Ibis/DuckDB) with an asyncpg connection pool targeting the query engine. All backend analytical operations — dataset preview, row count, column type inspection, cleaning preview — execute as SQL queries over this pool.

**Why over alternatives:**
- *Keep in-process DuckDB for internal queries, engine for external only*: Two query paths to maintain. Divergence risk between what users see in the web UI vs external tools.
- *Ibis with PostgreSQL backend*: Ibis adds an abstraction layer that's unnecessary when the queries are already generated as SQL strings (bootstrap_sql, cleaning SQL).

**Implications:** `duckdb_factory.py` is removed. `lake/repository.py` methods switch from `ibis.duckdb.connect()` to asyncpg queries. The `ibis-framework[duckdb]` dependency is removed (or reduced if Ibis is used elsewhere). CSV-to-Parquet conversion may need to remain local (or use COPY ... TO in the engine).

### D7: Frontend engine list/detail views + reworked project panel

**Decision:**
- New route `/query-engines` → engine list view (TanStack Query, key factory `queryEngineKeys`)
- New route `/query-engines/:id` → engine detail view with connection strings, projects, quick-start guides
- Existing `SqlAccessPanel` reworked to show per-dataset sync status, credentials, engine link
- Real-time sync status via polling (short interval) against outbox-derived state in the API

**Why over alternatives:**
- *SSE/WebSocket for real-time sync status*: The frontend already uses polling patterns (TanStack Query `refetchInterval`). Adding SSE for one feature introduces a new transport pattern. Polling at 3-5s is sufficient for "syncing → synced" transitions.
- *Embed engine details in project panel*: Clutters the project view with org-level information. Separation matches the mental model (engines are org resources, project panel shows project-level permissions).

## Risks / Trade-offs

**[Single engine = single point of failure]** → The query engine is always-on, but if it goes down, both the web app (previews) and external tools lose query access. Mitigation: health check endpoint + status visibility in UI. Future: multi-node support is modeled but not orchestrated.

**[Outbox polling latency]** → Events are processed on a 1-2 second poll interval, not instant. Users may see a brief "pending" state after upload. Mitigation: the UI shows sync status, so the delay is visible and expected. Can reduce interval or switch to notify/listen later.

**[Migration from per-project containers]** → Existing deployments have per-project containers and PgBouncer sidecars. Migrating requires: (1) standing up the shared engine, (2) re-bootstrapping each project's views, (3) updating connection details for BI tools. Mitigation: provide a migration script that reads existing `ExternalAccessRecord` entries and bootstraps them in the new engine. Document the BI tool reconfiguration step.

**[Proxy role complexity]** → Two roles per project (internal + proxy) adds PostgreSQL object count and cognitive overhead. Mitigation: the proxy role is simple (`SET ROLE` privilege only). Management is encapsulated in `pg_duckdb_manager.py`. Users never see internal role names.

**[CSV-to-Parquet conversion locality]** → Currently done in-process via DuckDB. Moving to the engine means the CSV file must be accessible to the engine (via S3 or shared volume). Mitigation: upload flow already writes to S3 first; the engine reads from S3. If needed, keep CSV-to-Parquet as a local operation using a lightweight library (e.g., PyArrow) instead of DuckDB.

**[SQLite dev mode compatibility]** → The outbox and new models use SQLAlchemy async. SQLite via aiosqlite supports this. The query engine itself is PostgreSQL-only, so local dev needs the engine container running (`docker compose up query-engine`). Mitigation: document this in dev setup. The metadata catalog (SQLite) remains independent of the engine.

## Migration Plan

### Phase 1: Add query engine service + data model
1. Add `query-engine` service to docker-compose with init script
2. Create `QueryEngineNode` model + Alembic migration
3. Add `engine_node_id` FK to `ExternalAccessRecord` (nullable initially)
4. Seed a default engine node from settings on backend startup

### Phase 2: Replace backend analytical queries
5. Create asyncpg connection pool to query engine in `database.py`
6. Migrate `lake/repository.py` methods from Ibis/DuckDB to asyncpg
7. Remove `duckdb_factory.py` and `ibis-framework[duckdb]` dependency

### Phase 3: Implement event-driven sync
8. Add new outbox event types (`DatasetSyncRequested`, `TransformSyncRequested`, `DatasetRemoved`)
9. Emit events in dataset upload, transform create/update/delete use cases
10. Implement sync processor (background asyncio task)
11. Add per-dataset sync status to API responses

### Phase 4: Simplify provisioner + credentials
12. Implement `QueryEngineProvisioner` (schema/role lifecycle)
13. Add proxy role pattern to `pg_duckdb_manager.py`
14. Rewrite enable/disable use cases to use new provisioner
15. Remove `docker_provisioner.py`, `pgbouncer_provisioner.py`, `port_allocation.py`, `aiodocker`

### Phase 5: Frontend
16. Add engine list/detail views + API endpoints
17. Rework `SqlAccessPanel` to permissions/sync page
18. Add per-dataset sync status indicators

### Rollback
- Each phase can be rolled back independently via Alembic downgrade + reverting code
- Phase 2 is the riskiest (query path change). If issues arise, revert to `duckdb_factory.py` (kept in git history)
- Engine node data model additions are additive (nullable FK), so rollback doesn't lose data

## Open Questions

1. **CSV-to-Parquet conversion**: Should this move to the query engine (`COPY ... TO 's3://...' (FORMAT PARQUET)`) or stay local using PyArrow? Moving it to the engine simplifies the backend but requires the engine to have write access to S3.

2. **Sync processor hosting**: Should the sync processor be a separate worker process or an asyncio background task in the backend? A separate process is more resilient but adds deployment complexity.

3. **Engine admin credentials storage**: The `QueryEngineNode` stores admin credentials for DDL. Should these be encrypted at rest in the database, or pulled from environment variables / secrets manager?

4. **Connection string format for ODBC/JDBC**: What exact format strings should the engine detail page show? This depends on driver-specific syntax (e.g., ODBC requires `Driver={PostgreSQL Unicode};Server=...;Port=...;Database=...`).

5. **Legacy migration cutover**: Should the migration script automatically re-bootstrap existing projects, or require manual per-project re-enablement?
