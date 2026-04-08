# ADR-008: MinIO / S3 for File Storage over Local Filesystem

## Status

Accepted

## Context and Problem Statement

Uploaded files and converted Parquet datasets need durable storage accessible by multiple services. The storage solution must decouple file access from any single service instance and support direct reads from analytical engines (DuckDB, pg_duckdb).

## Decision Drivers

- Decoupled file access across multiple services
- Direct Parquet reads from DuckDB (`httpfs`) and pg_duckdb without intermediate copies
- Local development experience that mirrors production S3
- Web console for debugging storage contents during development

## Considered Options

1. **S3-compatible object storage (MinIO in dev, S3 in production)** (selected)
2. **Local filesystem with shared volumes**

### Option 1: MinIO / S3

- Good, because object storage decouples file access from any single service instance
- Good, because both DuckDB (`httpfs`) and pg_duckdb can read Parquet directly from S3
- Good, because MinIO provides a local S3-compatible development experience with a web console for debugging
- Bad, because all services need S3 credentials configured

### Option 2: Local Filesystem

- Good, because it requires no additional infrastructure or credentials
- Good, because file access is simple and direct
- Bad, because it couples storage to a single service instance
- Bad, because it does not support direct reads from DuckDB's `httpfs` extension
- Bad, because shared volumes are fragile in multi-service deployments

## Decision Outcome

Chosen option: **MinIO / S3**, because it decouples file access from service instances and enables direct Parquet reads from DuckDB and pg_duckdb via the `httpfs` extension.

### Consequences

- **Good:** File operations use the S3 API (boto3/aioboto3), and storage paths follow a convention: `datasets/{project_id}/{dataset_id}/`. DuckDB reads directly from S3 without intermediate copies
- **Bad:** All services need S3 credentials configured. MinIO adds a service to the development Docker Compose stack

## Confirmation

Verify that DuckDB can read Parquet files directly from MinIO via `httpfs` in development and from S3 in production. Confirm that file uploads via boto3 are accessible to all services.

## Related

- [ADR-003: DuckDB / pg_duckdb for Analytical Queries](adr-003-duckdb-pg-duckdb-analytics.md) -- DuckDB reads Parquet from S3 via `httpfs`
