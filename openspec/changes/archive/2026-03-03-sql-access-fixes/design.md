## Context

The SQL access feature provisions ephemeral pg_duckdb containers that expose project data as PostgreSQL views over S3/MinIO parquet files. End-to-end testing with Excel/ODBC revealed five runtime bugs: missing DuckDB role authorization, transient S3 secrets, wrong MinIO endpoint for container networking, invisible view columns, and an insufficient connection limit.

The provisioning pipeline is:
```
enable_sql_access()
  → docker_provisioner.provision()    → container + health check + S3 secrets
  → create_project_schema()           → schema + reader role + grants
  → generate_bootstrap_sql()          → views over read_parquet()
  → execute_bootstrap()               → run DDL via admin connection
  → grant_schema_usage()              → SELECT on views to reader role
```

All fixes target the backend Python code. No frontend or worker changes are needed.

## Goals / Non-Goals

**Goals:**
- External ODBC clients (Excel, Power BI) can connect, see typed columns, and query data
- Provisioned containers survive restarts without manual intervention
- Multi-tenant group role pattern is forward-compatible with shared containers
- All fixes are backward-compatible with existing provisioned environments

**Non-Goals:**
- Multi-container orchestration (Kubernetes, ECS) — stays Docker-only for now
- Port stability across restarts (deterministic port assignment deferred)
- Automatic re-provisioning of degraded environments (reconciliation only detects + re-applies config)
- Schema evolution (column additions/removals on live views)

## Decisions

### D1: Group role for `duckdb.postgres_role` (over per-role GUC)

**Choice**: Create a `duckdb_readers` NOLOGIN group role and set `duckdb.postgres_role = 'duckdb_readers'`. Grant individual reader roles membership in this group.

**Alternatives considered**:
- *Per-role ALTER SYSTEM*: Only one role can be set as `duckdb.postgres_role`. Each new project would overwrite the previous, breaking existing projects on the same container.
- *Superuser reader roles*: Defeats the purpose of least-privilege isolation.

**Rationale**: The group role pattern is the standard PostgreSQL approach for shared permissions. It's idempotent (safe to call on every provision), forward-compatible with multi-tenant containers, and requires no container restarts since `pg_reload_conf()` applies the GUC.

### D2: `PERSISTENT` secrets (over reconciliation-only re-apply)

**Choice**: Change `CREATE OR REPLACE SECRET` → `CREATE OR REPLACE PERSISTENT SECRET`.

**Alternatives considered**:
- *Reconciliation-only re-apply*: Depends on the backend being up and running a reconciliation cycle after every container restart. Fragile.
- *Docker volume for DuckDB data*: Would persist secrets but adds volume management complexity.

**Rationale**: One-word change with no downsides. DuckDB persistent secrets survive process restarts. Combined with reconciliation re-apply as defense-in-depth.

### D3: Separate `minio_internal_endpoint` setting (over overloading `minio_endpoint`)

**Choice**: Add a new `minio_internal_endpoint` config setting (default: `""`). Use it when building `StorageConfig` for pg_duckdb containers, falling back to `minio_endpoint` when empty.

**Alternatives considered**:
- *Overload `minio_endpoint`*: Would break the backend itself, which uses `minio_endpoint` for its own S3 client (`localhost:9000` is correct for the backend; `minio:9000` is correct for pg_duckdb).
- *Derive from Docker network*: Auto-detection adds complexity and fragile heuristics.

**Rationale**: Explicit is better than implicit. Two different network contexts (backend → MinIO vs. pg_duckdb → MinIO) need two different endpoints. The `or` fallback handles production S3 where both are the same.

### D4: Type-aware `_build_typed_select()` with fallback (over always `SELECT *`)

**Choice**: Generate `r['col']::pg_type AS "col"` for each field in `schema_config.fields`. Fall back to `SELECT *` for datasets without schema info.

**Alternatives considered**:
- *Always `SELECT *`*: Current behavior — broken for ODBC clients.
- *Introspect parquet at view creation time*: Would require a DuckDB query to read the parquet schema. Adds latency and a dependency on S3 being reachable during bootstrap.
- *Store DuckDB types separately*: Adds schema duplication. We already have `schema_config.fields` with type information.

**Rationale**: `schema_config.fields` is already populated during dataset creation and contains the type information needed. A static mapping from app types (`text`, `number`, etc.) to PostgreSQL types is simple and maintainable. The fallback preserves backward compatibility for legacy datasets.

### D5: Connection limit 10 + idle timeout (over just raising the limit)

**Choice**: Raise `CONNECTION_LIMIT` from 3 to 10 (configurable via settings), and add `idle_session_timeout = '5min'` per role.

**Alternatives considered**:
- *Just raise to 10*: Helps but doesn't address stale connections accumulating over time.
- *Unlimited connections*: Removes the safety net against resource exhaustion.

**Rationale**: 10 connections accommodates Excel (3-5 concurrent) plus Power BI or multiple tools. The idle timeout prevents stale connections from filling the limit. PostgreSQL 16 (used by pg_duckdb) supports `idle_session_timeout` as a per-role GUC.

## Risks / Trade-offs

- **[`pg_reload_conf()` may not apply `duckdb.postgres_role`]** → pg_duckdb docs suggest a restart may be needed. Mitigation: test with `pg_reload_conf()` first. If it doesn't work, add a container restart step after `ALTER SYSTEM SET`. The `ensure_duckdb_role_configured()` function is the single place to change.

- **[PERSISTENT secrets on ephemeral filesystem]** → Container recreation (not restart) loses the DuckDB data directory. Mitigation: `configure_s3_secrets()` is already called during `provision()`, which handles creation. PERSISTENT only helps with restarts.

- **[Type mapping may be incomplete]** → New app types added in the future won't have a PostgreSQL mapping. Mitigation: fallback to `text` for unknown types. The `_PG_TYPE_MAP` is a single dict to extend.

- **[Reconciliation re-apply adds startup latency]** → Each healthy environment gets two extra admin connections (GUC check + secret re-apply). Mitigation: acceptable for startup; environments are typically few (< 10 in dev). Production can disable reconciliation or run it async.

- **[5-minute idle timeout may interrupt long Excel sessions]** → Excel may hold connections idle between user interactions. Mitigation: 5 minutes is generous for metadata queries. Data-intensive sessions keep connections active. If needed, timeout is configurable per role.

## Open Questions

- None — all decisions are self-contained and testable.
