-- pg_duckdb init script: configure S3 access for MinIO
-- Runs on first container start via /docker-entrypoint-initdb.d/
--
-- DEV ONLY: Credentials below match the docker-compose MinIO defaults.
-- For production, replace with actual credentials or use a secret manager.

-- Ensure pg_duckdb extension is loaded
CREATE EXTENSION IF NOT EXISTS pg_duckdb;

-- Configure S3/MinIO access for read_parquet() calls
-- These secrets persist in the DuckDB catalog
SELECT duckdb.raw_query($q$
  CREATE OR REPLACE SECRET minio_secret (
    TYPE S3,
    KEY_ID 'minioadmin',
    SECRET 'minioadmin',
    ENDPOINT 'minio:9000',
    URL_STYLE 'path',
    USE_SSL false,
    REGION 'us-east-1'
  );
$q$);
