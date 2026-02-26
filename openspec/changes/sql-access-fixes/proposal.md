## Why

End-to-end testing of the SQL access feature with real ODBC/Excel clients exposed five data-path bugs in the provisioning and configuration pipeline. External clients either cannot connect (role permission errors, lost S3 secrets, wrong MinIO endpoint) or see mangled column metadata (composite `USER-DEFINED` type instead of real columns). Connection limits are too restrictive for tools like Excel that open multiple concurrent connections. These must be fixed before the SQL access feature is usable outside of development.

## What Changes

- Configure `duckdb.postgres_role` GUC via a group role so reader roles can execute DuckDB queries
- Make S3/MinIO secrets persistent so they survive container restarts
- Route the MinIO endpoint through Docker-internal hostname (`minio:9000`) instead of `localhost:9000` for pg_duckdb containers
- Generate views with explicit typed columns (`r['col']::type AS col`) instead of `SELECT *` so ODBC clients see proper column metadata
- Increase connection limit from 3 to 10 and add idle session timeout for auto-cleanup
- Enhance reconciliation to re-apply runtime config (GUC, secrets) after container restarts

## Capabilities

### New Capabilities
- `duckdb-role-configuration`: Configure the `duckdb.postgres_role` PostgreSQL GUC using a group role pattern that supports multi-tenant containers
- `typed-view-columns`: Generate bootstrap SQL views with explicit column types derived from dataset `schema_config` for ODBC/Excel visibility
- `resilient-runtime-config`: Make S3 secrets persistent, add internal MinIO endpoint routing, and enhance reconciliation to re-apply lost config

### Modified Capabilities

## Impact

- **Backend config** (`config.py`): New `minio_internal_endpoint` and `pg_duckdb_connection_limit` settings
- **pg_duckdb manager** (`pg_duckdb_manager.py`): New `ensure_duckdb_role_configured()`, persistent secrets, configurable connection limit, idle timeout
- **Docker provisioner** (`docker_provisioner.py`): Call GUC setup during provisioning
- **Bootstrap SQL** (`bootstrap_sql.py`): Type-aware view generation with DuckDB-to-PostgreSQL type mapping
- **Enable/sync use cases** (`enable_sql_access.py`, `sync_sql_access.py`): Use internal MinIO endpoint
- **Reconciliation** (`reconcile_sql_access.py`): Re-apply secrets and GUC on healthy-but-restarted containers
- **Docker Compose** (`docker-compose.yml`): New `MINIO_INTERNAL_ENDPOINT` env var
- **Tests**: Updates to bootstrap SQL tests, new pg_duckdb manager tests
