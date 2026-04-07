# Dataset Lifecycle

The dataset lifecycle covers the full journey from file upload through transformation to query execution.

## Pipeline Overview

```
Upload → Format Detection → Parquet Conversion → S3 Storage → Transform Pipeline → Query
```

## 1. File Upload

Users upload files via `POST /api/uploads`. The upload system:

1. Accepts CSV, Excel (.xlsx/.xls), JSON, and Parquet files
2. Routes through a **format plugin registry** — each format implements detection, validation, and conversion
3. Stores the raw file at `uploads/{project_id}/{upload_id}/raw/` in MinIO
4. For multi-sheet Excel files, returns an `awaiting_input` status so the user can select which sheet(s) to import

## 2. Ingestion Pipeline

Once format is confirmed, the ingestion pipeline (`_pipeline/ingestion.py`):

1. Converts the source file to **Parquet** format
2. Applies user-selected **partition fields** (if any)
3. Stores converted Parquet at `datasets/{project_id}/{dataset_id}/`
4. Generates **preview rows** (first N rows for quick display)
5. Computes **column profiles** (type distribution, cardinality, null counts)

## 3. Schema Configuration

Each dataset stores a `schema_config` JSON that defines:

- **columns**: list of `{id, type}` pairs (string, integer, decimal, boolean, date, datetime, time)
- **partition_fields**: columns used for Hive-style partitioning in Parquet storage

The schema drives tool definitions in the chat agent — column names and types are injected into the LLM system prompt so tool calls reference valid columns.

## 4. Transform Pipeline

Transforms modify the dataset's logical view without altering stored Parquet files. The pipeline uses **Ibis expressions** compiled to SQL.

### Three-Stage Pipeline

```
Stage 1: MUTATE   → cleaning transforms (trim, case, fill_null, map_values)
Stage 2: FILTER   → filter transforms (conditions on column values)
Stage 3: RENAME   → alias transforms (column display names)
```

### Transform Types

| Type | Stage | Description |
|------|-------|-------------|
| `clean` | MUTATE | Whitespace trim, case standardization, null fill, value mapping |
| `filter` | FILTER | Row-level conditions (equals, contains, gt, lt, between, etc.) |
| `alias` | RENAME | Column display name overrides |
| `map` | MUTATE | Exact-match value replacement |

### Transform Status

Transforms support soft lifecycle management:
- **enabled** — actively applied in the pipeline
- **disabled** — preserved but skipped (reversible)
- **deleted** — soft-deleted, excluded from all queries

### SQL Generation

Each dataset exposes two SQL representations:

- **`staging_sql`** — compact SQL using `read_parquet()` with S3 paths, used by the query engine
- **`display_sql`** — human-readable SQL with dataset name as alias, shown in the UI

## 5. Query Execution

### Internal (Preview)

The API executes `staging_sql` against DuckDB (via Ibis) to generate preview rows and column profiles. This happens in-process without hitting the external query engine.

### External (SQL Access)

When SQL access is enabled for a project:

1. A dedicated **pg_duckdb schema** is created per project
2. **Foreign tables** are created as views wrapping `read_parquet()` calls
3. The query engine reads Parquet files from MinIO via the `httpfs` extension
4. **PgBouncer** provides connection pooling for external clients
5. External SQL clients connect via standard PostgreSQL wire protocol

## 6. Downstream: Views and Reports

Datasets feed into higher-level abstractions:

- **Views** — combine columns from multiple datasets/views with joins, filters, and grain definitions
- **Reports** — analytical outputs with materialization strategies (view, table, ephemeral, incremental)

Both generate SQL definitions that reference dataset staging SQL, forming a dependency graph that can be exported as a **dbt project**.
