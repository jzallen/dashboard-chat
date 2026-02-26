# SQL Access: Bug Fixes & Improvements Backlog

**Date**: 2026-02-26
**Context**: End-to-end testing of SQL access feature via Excel/ODBC exposed multiple issues in the provisioning and configuration pipeline.

## Status

| # | Issue | Severity | Quick-fixed in code? | Needs permanent fix? |
|---|-------|----------|---------------------|---------------------|
| 1 | Docker image not pre-pulled | Critical | Yes | Done |
| 2 | Container-to-container networking | Critical | Yes | Done |
| 3 | `duckdb.postgres_role` not configured | Critical | No | Yes |
| 4 | S3 secrets not persistent | Critical | No | Yes |
| 5 | S3 endpoint uses `localhost` | Critical | No | Yes |
| 6 | View columns invisible to ODBC clients | Critical | No | Yes |
| 7 | Connection limit too low | Medium | No | Yes |

---

## 1. Docker image not pre-pulled (FIXED)

**File**: `backend/app/use_cases/sql_access/docker_provisioner.py`

The provisioner tried to create a container from `pgduckdb/pgduckdb:16-main` without ensuring the image existed locally. Added `_ensure_image()` method that calls `docker.images.inspect()` and falls back to `docker.images.pull()`.

## 2. Container-to-container networking (FIXED)

**Files**: `docker_provisioner.py`, `provisioner.py`, `pg_duckdb_manager.py`

The API container and pgduckdb container are on the same Docker bridge network (`dashboard-chat_default`). All internal connections (health check, S3 secret configuration, schema management) used `localhost:{host_port}`, which is unreachable from inside another container — the host-mapped port is only accessible from the Docker host.

**Fix applied**:
- Added `internal_host` / `internal_port` fields to `ProjectEnvironment`
- Health check connects to container name on port 5432
- `_get_connection()` uses internal fields for all backend operations
- `host`/`port` remain as `localhost:{mapped_port}` for external client access

## 3. `duckdb.postgres_role` GUC not configured (NEEDS FIX)

**Symptom**: `ERROR: DuckDB execution is not allowed because you have not been granted the duckdb.postgres_role`

pg_duckdb requires the PostgreSQL server setting `duckdb.postgres_role` to specify which role is allowed to execute DuckDB queries. By default only superusers can. The reader role created by `create_project_schema` is not a superuser.

**Fix needed**: After creating the reader role, the provisioner must run:
```sql
ALTER SYSTEM SET duckdb.postgres_role = '<role_name>';
SELECT pg_reload_conf();
```
Note: This setting requires a server restart per the docs, but `pg_reload_conf()` may work in some versions. If not, the container needs a restart after setting it. This also has multi-tenant implications — only one role can be set as `duckdb.postgres_role`. A group role approach may be needed if multiple reader roles coexist.

**Ref**: https://github.com/duckdb/pg_duckdb/blob/main/docs/settings.md

## 4. S3 secrets are not persistent (NEEDS FIX)

**File**: `backend/app/use_cases/sql_access/pg_duckdb_manager.py` → `configure_s3_secrets()`

The function uses `CREATE OR REPLACE SECRET` which creates a transient in-memory secret. When the pgduckdb container restarts, the secret is lost and all `read_parquet('s3://...')` calls fail with HTTP 404.

**Fix needed**: Change to `CREATE OR REPLACE PERSISTENT SECRET` so the secret survives restarts.

## 5. S3 endpoint uses `localhost` instead of Docker hostname (NEEDS FIX)

**File**: `backend/app/use_cases/sql_access/enable_sql_access.py` (line 86)

`storage_config.endpoint` is set from `settings.minio_endpoint` which defaults to `localhost:9000`. The pgduckdb container can't reach MinIO via `localhost` — it needs the Docker network hostname `minio:9000`.

**Fix needed**: The provisioner needs a separate "internal" MinIO endpoint config (e.g. `minio_internal_endpoint` defaulting to `minio:9000`) for S3 secrets injected into pgduckdb containers.

## 6. View columns invisible to ODBC/external clients (NEEDS FIX)

**File**: `backend/app/use_cases/project/dbt/bootstrap_sql.py` → `generate_bootstrap_sql()`

Current view definition:
```sql
CREATE VIEW schema.view AS
  SELECT * FROM read_parquet('s3://...');
```

PostgreSQL registers this as a single composite column `read_parquet` of type `USER-DEFINED` in `information_schema.columns`. Tools like Excel/ODBC see only one column with row IDs.

**Fix needed**: Generate views with explicit typed columns using the `r['col']::type` syntax:
```sql
CREATE VIEW schema.view AS
  SELECT
    r['col1']::bigint AS col1,
    r['col2']::text AS col2,
    ...
  FROM read_parquet('s3://...') r;
```

Column names and types are available in the dataset's `schema_config`. The `generate_bootstrap_sql()` function needs to accept schema info and build the typed SELECT list. A DuckDB-to-PostgreSQL type mapping is needed (e.g. `VARCHAR` → `text`, `BIGINT` → `bigint`, `DOUBLE` → `double precision`).

## 7. Connection limit too low (NEEDS FIX)

**File**: `backend/app/use_cases/sql_access/pg_duckdb_manager.py` (line 23)

`CONNECTION_LIMIT = 3` is too restrictive. Tools like Excel open multiple concurrent connections for metadata inspection and data retrieval. Stale idle connections fill up the limit quickly.

**Fix needed**: Increase `CONNECTION_LIMIT` to 10 (or make it configurable). Consider also setting `idle_session_timeout` on the role to auto-close idle connections.

---

## Additional Design Considerations

- **Port stability**: `HostPort: "0"` auto-assigns a port that changes on container restart. Consider assigning deterministic ports or updating the stored `environment_port` after restarts during reconciliation.
- **Multi-tenant `duckdb.postgres_role`**: Only one role can be set. If multiple projects share a container (future), a group role with individual reader roles as members would be needed.
- **Reconciliation**: The existing `reconcile_sql_access` use case should re-apply S3 secrets and verify `duckdb.postgres_role` after detecting a container restart.
