# NFR-H2: SQL Access Query Latency

## Tag

H2 — Handoff: Performance

## Ambition

Provide fast query response times for external SQL clients accessing project data, enabling productive use of BI tools and ad-hoc analysis.

## Planguage

| Field | Value |
|-------|-------|
| **Scale** | Time to first row returned for a SQL query via external client |
| **Meter** | P95 on datasets under 1M rows connected via psql |
| **Must** | < 10 seconds |
| **Plan** | < 5 seconds |

## Quality Attribute Scenario

| Element | Value |
|---------|-------|
| **Source** | External SQL client (psql, BI tool, ODBC/JDBC driver) |
| **Stimulus** | Executes a SQL query against project data |
| **Environment** | Normal operation, dataset under 1M rows |
| **Artifact** | pg_duckdb query engine (reads Parquet via httpfs) |
| **Response** | System returns query results to the client |
| **Response Measure** | P95 time-to-first-row < 10 s (Must) / < 5 s (Plan) |

## Status

**Implemented** — pg_duckdb reads Parquet via httpfs

## Verification Method

Measure P95 time-to-first-row for SQL queries via psql on datasets under 1M rows.

## Related

- [ADR-003: DuckDB / pg_duckdb](../decisions/adrs.md)
