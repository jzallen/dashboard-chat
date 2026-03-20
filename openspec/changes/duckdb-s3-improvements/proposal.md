## Why

The DuckDB/httpfs stack can push filter predicates down to Parquet row groups on S3, but this capability is never exercised because the filtered query path and the data read path are disconnected. Users previewing filtered datasets pay full network transfer cost even though DuckDB could skip irrelevant row groups. Separately, repeated per-request DuckDB connection setup (install/load httpfs, configure S3 credentials) adds latency on every preview and row count call.

## What Changes

- Wire active transforms (column projection + WHERE filters) into `read_parquet_preview()` so DuckDB executes predicate-pushed queries against S3 instead of reading all data then discarding
- Add column projection to preview reads — only fetch columns present in the schema config
- Pool or reuse DuckDB connections per-request to avoid repeated `INSTALL httpfs; LOAD httpfs; SET s3_*` overhead
- Extract duplicated S3 credential configuration into a single shared utility (`_configure_duckdb_s3`)
- Auto-select `S3LakeRepository` vs `MinIOLakeRepository` in `RepositoryContainer` based on `settings.storage_type`

## Capabilities

### New Capabilities
- `duckdb-predicate-pushdown`: Filtered dataset previews execute pushed-down queries against S3 Parquet row groups
- `duckdb-connection-lifecycle`: Connection reuse / pooling strategy for DuckDB within a request lifecycle

### Modified Capabilities
- `duckdb-role-configuration`: S3 credential setup consolidation changes how DuckDB is configured at the repository layer

## Impact

- `backend/app/repositories/lake/` — read path, connection management, S3 config
- `backend/app/repositories/metadata/dataset.py` — `_build_table()` connected to read path
- `backend/app/repositories/__init__.py` — `RepositoryContainer` auto-selection logic
- Preview response times and S3 data transfer costs for filtered datasets
