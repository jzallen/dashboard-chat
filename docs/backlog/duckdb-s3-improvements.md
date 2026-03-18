# DuckDB S3 Improvements

## Context

The lake repository wraps DuckDB + httpfs for reading Parquet from S3 and boto3 for writes. The wrapper was designed for testability (injectable S3 client, mockable repository). An investigation confirmed that httpfs predicate pushdown is architecturally preserved — DuckDB reads `s3://` URLs directly, the wrapper never downloads files first. However, the pushdown capability is never actually exercised because the filtered query path and the data read path are disconnected.

## 1. Wire filters into the read path

`Dataset._build_table()` already assembles Ibis expressions with column projection and WHERE filters from transforms. But it's only used to generate display SQL via `ibis.to_sql()` — never executed against data. Meanwhile `read_parquet_preview()` runs unfiltered `LIMIT`-only queries against S3.

These two paths need to be connected so that when a user previews a dataset with active transforms, DuckDB pushes predicates down to Parquet row groups on S3 instead of reading everything and discarding.

This is the main unrealized value of having httpfs in the stack.

## 2. Add column projection to preview reads

`read_parquet_preview()` reads all columns. For wide datasets this transfers unnecessary column chunks over the network. The schema fields are already known — pass them through so DuckDB only fetches the columns needed.

## 3. Pool or cache DuckDB connections

Every read creates an ephemeral `ibis.duckdb.connect()`, runs `INSTALL httpfs; LOAD httpfs;`, and configures S3 credentials from scratch. This overhead compounds on every preview and row count request. A shared connection per request lifecycle (or a lightweight pool) would eliminate the repeated setup.

## 4. Consolidate S3 configuration

DuckDB S3 credentials are configured identically in three places:

- `MinIOLakeRepository._configure_duckdb_s3()` (repository.py)
- `S3LakeRepository._configure_duckdb_s3()` (repository.py)
- `Dataset._get_connection()` (dataset.py)

Extract into a single shared utility so changes only happen in one place.

## 5. Auto-select S3LakeRepository in production

`RepositoryContainer` always defaults to `MinIOLakeRepository`. The `S3LakeRepository` variant exists but is never automatically selected. Wire the container to check `settings.storage_type` and pick the right implementation.
