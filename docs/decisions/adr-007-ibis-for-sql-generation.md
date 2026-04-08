# ADR-007: Ibis for SQL Generation over Raw SQL

## Status

Accepted

## Context and Problem Statement

Datasets need a composable query pipeline that applies transforms (clean, filter, rename) to Parquet files. The pipeline must be dialect-agnostic, compiling to different SQL dialects depending on the target (DuckDB for previews, PostgreSQL for external access).

## Decision Drivers

- Composable, pandas-like API for building SQL programmatically
- Dialect-agnostic compilation (DuckDB SQL and PostgreSQL SQL from the same expressions)
- Natural expression of the 3-stage pipeline (MUTATE, FILTER, RENAME) as chained operations
- No query execution at expression-building time

## Considered Options

1. **Ibis expressions** (selected)
2. **Raw SQL strings**

### Option 1: Ibis

- Good, because it provides a pandas-like API that compiles to SQL without executing queries
- Good, because the 3-stage pipeline (MUTATE, FILTER, RENAME) is naturally expressed as chained operations
- Good, because the same expressions compile to DuckDB SQL for previews and PostgreSQL SQL for external access
- Bad, because it adds Ibis as a dependency
- Bad, because SQL debugging requires inspecting compiled output rather than hand-written queries

### Option 2: Raw SQL

- Good, because SQL is directly readable and debuggable
- Good, because it requires no additional dependencies
- Bad, because composing transforms requires string manipulation, which is fragile and injection-prone
- Bad, because supporting multiple SQL dialects requires maintaining separate query templates
- Bad, because the 3-stage pipeline becomes procedural string building rather than declarative composition

## Decision Outcome

Chosen option: **Ibis expressions**, because they provide a composable, dialect-agnostic query pipeline that naturally expresses the transform stages without string manipulation.

### Consequences

- **Good:** Composable query pipeline with dialect-agnostic compilation; transforms are declarative chained operations
- **Bad:** Adds Ibis as a dependency. Complex transforms may need raw SQL escape hatches. SQL debugging requires inspecting compiled output

## Confirmation

Verify that the same Ibis expression chain compiles correctly to both DuckDB SQL and PostgreSQL-compatible SQL. Confirm that the MUTATE, FILTER, RENAME pipeline produces expected query output.

## Related

- [ADR-003: DuckDB / pg_duckdb for Analytical Queries](adr-003-duckdb-pg-duckdb-analytics.md) -- Ibis compiles to DuckDB SQL for the in-process query path
