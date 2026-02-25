# Mini Postgres for External Connectivity

## Summary

Provide external SQL connectivity (ODBC, dbt CLI, BI tools) via ephemeral Postgres instances backed by `pg_duckdb`, while the web UI continues using DuckDB + Ibis directly for table previews.

## Use Case

A user configures datasets in the dashboard UI, then connects from Excel (or Power BI, Tableau, etc.) via ODBC to query those datasets with SQL. Data engineers can also export the dbt project and work from their own IDE, using the same Postgres connection.

## Two Data Paths, One Source of Truth

Dataset metadata is the single source of truth. Two paths serve different audiences:

| Path | Engine | Purpose | Users |
|---|---|---|---|
| Web UI previews | DuckDB + Ibis (direct) | Fast, in-process table rendering | Low-code users in browser |
| External connectivity | Mini Postgres (pg_duckdb) | ODBC, dbt CLI, BI tools | Data engineers, Excel/BI users |

Both read from the same Parquet files in S3. The web UI path is unchanged — `MinIOLakeRepository` with DuckDB + Ibis continues to power table previews.

## Architecture

### Mini Postgres Instance

- Ephemeral Postgres with `pg_duckdb` extension
- Bootstrapped from dataset metadata and the workspace's dbt project
- Workspace-scoped lifecycle: spin up on open, tear down on close
- Restrictive connection limits (~2-3 max): one for web portal, one for BI tools, one for dbt runner
- Read-only pass-through to S3 Parquet — not a data store, purely a protocol adapter + auth layer
- Each Postgres connection gets its own DuckDB engine instance (pg_duckdb architecture), keeping memory bounded with limited connections

### pg_duckdb (v1.0+)

- Embeds DuckDB's analytical engine inside Postgres
- `read_parquet('s3://...')` from standard SQL
- S3 secrets configured via `duckdb.create_simple_secret()`
- Per-connection DuckDB instances — concurrent reads work without contention
- Postgres handles auth, roles, schema isolation natively

### Bootstrap Pipeline

```
Dataset metadata (dashboard-chat)
        |
  Ibis (schema + S3 path translation)
        |
  bootstrap_db.sql (CREATE VIEW ... AS SELECT * FROM read_parquet('s3://...'))
        |
  dbt sources.yml (declares those views as dbt sources)
        |
  dbt staging/marts models (views, not tables)
        |
  Mini Postgres (pg_duckdb, max_connections=3)
        |
  Web portal | Excel/ODBC | dbt CLI
```

Ibis already knows how to map dataset metadata to DuckDB/S3 paths via `MinIOLakeRepository`. The bootstrap step reuses this to generate Postgres DDL with `read_parquet()` views.

## dbt Project Structure

```
dbt_project/
  scripts/
    bootstrap_db.sql          -- CREATE VIEW sources via read_parquet()
  models/
    sources.yml               -- dbt sources pointing at bootstrap views
    staging/
      stg_customers.sql       -- SELECT ... FROM {{ source('...', 'customers') }}
    marts/
      dim_customers.sql       -- business logic views
  profiles.yml                -- postgres connection
```

- **Sources** are Postgres views created by `bootstrap_db.sql` over `read_parquet()`
- **All models use `materialized='view'`** to conserve compute and memory — no data duplication, every query is a live pass-through to Parquet
- **Bootstrap script lives inside the dbt project** so the project is self-contained and runnable outside dashboard-chat

### dbt Export Integration

The existing dbt export feature produces a portable project. Including `bootstrap_db.sql` means an exported project is self-contained:

1. Engineer receives exported dbt project
2. Runs `psql -f scripts/bootstrap_db.sql` against their own Postgres (with pg_duckdb)
3. Runs `dbt run` — staging and mart views are created
4. Works from any IDE with full dbt tooling, no dashboard-chat dependency

### Upgrade Path to Persistent Infrastructure

The same dbt project ports to a permanent RDS with minimal changes:

1. Swap `read_parquet()` views in bootstrap script for `CREATE TABLE` + data load
2. Change dbt materialization from `view` to `table`/`incremental`
3. Point `profiles.yml` at RDS

The dbt project itself (sources, staging, marts) doesn't change.

## Security Notes

- Read-only access — views over Parquet, no write path
- Postgres roles and schema isolation handle multi-tenancy (org_id scoping)
- Connection limit caps resource usage per mini instance
- DuckDB SQL within pg_duckdb is sandboxed — no filesystem access from queries

## Dependencies

- `MinIOLakeRepository._configure_duckdb_s3` (backend/app/repositories/lake/repository.py) — Ibis/S3 path logic to reuse
- Dataset metadata for resolving storage paths and schemas
- dbt export feature (existing) — bootstrap script extends this
- Postgres 16+ with `pg_duckdb` extension
- Auth layer for org_id scoping

## Future: DataNode Compatibility

The dbt project generated here (sources → staging → marts, Postgres-backed) is the same artifact a DataNode would wrap. A user publishing to the exchange would use this dbt project unchanged — the DataNode adds MCP, Arrow Flight, and marketplace layers on top of the same `profiles.yml` connection.
