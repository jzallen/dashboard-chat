# ADR-003: DuckDB / pg_duckdb for Analytical Queries

## Status

Accepted

## Context and Problem Statement

Users need to query Parquet files stored in S3/MinIO with SQL, both internally (preview within the application) and externally (SQL access via standard database tools). The system needs an analytical query engine that reads columnar formats natively without ETL.

## Decision Drivers

- Native Parquet file reading without ETL pipelines
- External SQL access via standard PostgreSQL wire protocol for BI tools
- Direct S3/MinIO file access via the `httpfs` extension
- Compatibility with the Ibis expression framework for programmatic SQL generation

## Considered Options

1. **DuckDB (in-process) + pg_duckdb (external access)** (selected)
2. **PostgreSQL with foreign data wrappers**

### Option 1: DuckDB + pg_duckdb

- Good, because DuckDB reads Parquet natively via `read_parquet()` without ETL
- Good, because pg_duckdb exposes DuckDB's engine through PostgreSQL, letting external tools (DBeaver, psql, BI tools) connect using standard drivers
- Good, because the `httpfs` extension reads directly from S3
- Bad, because two query paths require schema synchronization between in-process DuckDB and pg_duckdb

### Option 2: PostgreSQL with Foreign Data Wrappers

- Good, because it provides a single query path through PostgreSQL
- Good, because it has mature tooling and ecosystem
- Bad, because foreign data wrappers for Parquet are less mature and performant
- Bad, because it requires ETL to load data or complex FDW configuration

## Decision Outcome

Chosen option: **DuckDB (in-process) + pg_duckdb (external access)**, because DuckDB reads Parquet natively without ETL and pg_duckdb provides standard PostgreSQL wire protocol access for external tools.

### Consequences

- **Good:** Two complementary query paths -- in-process DuckDB (via Ibis) for fast previews, and pg_duckdb for external SQL access through standard database drivers
- **Bad:** Schema synchronization between the two query paths requires explicit sync operations

## Confirmation

Verify that Parquet files in S3/MinIO are queryable both through the in-process DuckDB preview path and through pg_duckdb via a standard PostgreSQL client.

## Related

- [ADR-007: Ibis for SQL Generation](adr-007-ibis-for-sql-generation.md) -- Ibis compiles expressions to DuckDB SQL
- [ADR-008: MinIO / S3 for File Storage](adr-008-minio-s3-file-storage.md) -- storage layer that DuckDB reads from
- [ADR-012: Synthetic-First Healthcare Strategy](adr-012-synthetic-first-healthcare.md) -- synthetic data queried via DuckDB
