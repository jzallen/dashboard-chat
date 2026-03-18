## 1. Persistent S3 Secrets

- [ ] 1.1 In `pg_duckdb_manager.py` `configure_s3_secrets()`, change `CREATE OR REPLACE SECRET` to `CREATE OR REPLACE PERSISTENT SECRET` (line 117)
- [ ] 1.2 Update or add test assertions to verify the generated SQL contains `PERSISTENT`

## 2. Connection Limit and Idle Timeout

- [ ] 2.1 Add `pg_duckdb_connection_limit: int = 10` to `Settings` in `config.py`
- [ ] 2.2 Remove the hard-coded `CONNECTION_LIMIT = 3` constant from `pg_duckdb_manager.py` and update `build_create_role_sql()` to accept an optional `connection_limit` parameter, defaulting to `get_settings().pg_duckdb_connection_limit`
- [ ] 2.3 In `create_project_schema()`, add `ALTER ROLE ... SET idle_session_timeout = '5min'` after the search_path line
- [ ] 2.4 Update tests for `build_create_role_sql` to verify configurable limit and idle timeout

## 3. Internal MinIO Endpoint

- [ ] 3.1 Add `minio_internal_endpoint: str = ""` to `Settings` in `config.py`
- [ ] 3.2 In `enable_sql_access.py`, change `StorageConfig(endpoint=settings.minio_endpoint, ...)` to use `settings.minio_internal_endpoint or settings.minio_endpoint`
- [ ] 3.3 Apply the same change in `sync_sql_access.py` where `StorageConfig` is built
- [ ] 3.4 Add `MINIO_INTERNAL_ENDPOINT: "minio:9000"` to the backend service in `docker-compose.yml`
- [ ] 3.5 Add a unit test verifying the fallback logic (internal endpoint when set, minio_endpoint when empty)

## 4. DuckDB Group Role Configuration

- [ ] 4.1 Add `DUCKDB_READERS_GROUP = "duckdb_readers"` constant to `pg_duckdb_manager.py`
- [ ] 4.2 Implement `ensure_duckdb_role_configured(env)` function: create `duckdb_readers` role if not exists, `ALTER SYSTEM SET duckdb.postgres_role`, `pg_reload_conf()`
- [ ] 4.3 In `create_project_schema()`, change `GRANT duckdb.postgres_role TO ...` to `GRANT "duckdb_readers" TO ...`
- [ ] 4.4 In `docker_provisioner.py` `provision()`, call `ensure_duckdb_role_configured(env)` after health check and before `configure_s3_secrets()`
- [ ] 4.5 Add tests: idempotency of `ensure_duckdb_role_configured`, correct grant in `create_project_schema`

## 5. Typed View Columns in Bootstrap SQL

- [ ] 5.1 Add `_PG_TYPE_MAP` dict and `_PG_DEFAULT_TYPE = "text"` to `bootstrap_sql.py`
- [ ] 5.2 Implement `_build_typed_select(dataset, s3_uri)` helper that generates `r['col']::type AS "col"` expressions from `schema_config.fields`, falling back to `SELECT *` when fields are empty
- [ ] 5.3 Update `generate_bootstrap_sql()` to call `_build_typed_select()` instead of `SELECT * FROM read_parquet(...)`
- [ ] 5.4 Add test: dataset with schema_config produces typed column expressions
- [ ] 5.5 Add test: dataset without schema_config falls back to `SELECT *`
- [ ] 5.6 Add test: all type mappings produce correct PostgreSQL types
- [ ] 5.7 Add test: reserved-word column names are properly quoted

## 6. Reconciliation Enhancement

- [ ] 6.1 Update `reconcile_sql_access()` to build a `StorageConfig` from settings (same pattern as `enable_sql_access`)
- [ ] 6.2 For healthy environments, call `ensure_duckdb_role_configured(env)` and `configure_s3_secrets(env, storage_config)` with warning-level error handling
- [ ] 6.3 Add tests: reconciliation re-applies config on healthy environments, skips degraded ones
