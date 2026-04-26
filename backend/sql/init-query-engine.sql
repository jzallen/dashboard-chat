-- Query Engine initialization script
-- Runs once on first container start via docker-entrypoint-initdb.d
-- Idempotent: safe to re-run on restart (uses IF NOT EXISTS / OR REPLACE)

-- Install and load httpfs extension for S3/MinIO access
-- pg_duckdb exposes DuckDB extension management as Postgres functions
SELECT duckdb.install_extension('httpfs');

-- Create the shared group role for DuckDB query authorization
-- All per-project reader roles get membership in this group
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'duckdb_readers') THEN
        CREATE ROLE duckdb_readers NOLOGIN;
    END IF;
END
$$;

-- Configure pg_duckdb to authorize queries from duckdb_readers members
ALTER SYSTEM SET duckdb.postgres_role = 'duckdb_readers';
SELECT pg_reload_conf();
