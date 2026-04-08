# NFR-M2: Transform Preview Latency

## Tag

M2 — Model: Performance

## Ambition

Keep transform preview execution fast so users can iteratively refine data transformations without disruptive wait times.

## Planguage

| Field | Value |
|-------|-------|
| **Scale** | Time from transform preview request to rendered result |
| **Meter** | P95 on datasets under 100K rows |
| **Must** | < 5 seconds |
| **Plan** | < 2 seconds |

## Quality Attribute Scenario

| Element | Value |
|---------|-------|
| **Source** | End user |
| **Stimulus** | Requests a preview of a data transform |
| **Environment** | Normal operation, dataset under 100K rows |
| **Artifact** | pg_duckdb query engine |
| **Response** | System executes preview SQL and renders the result |
| **Response Measure** | P95 latency < 5 s (Must) / < 2 s (Plan) |

## Status

**Implemented** — pg_duckdb executes preview SQL

## Verification Method

Measure P95 wall-clock time from transform preview request to rendered result across datasets under 100K rows.

## Related

- [ADR-003: DuckDB](../decisions/adrs.md)
- [ADR-007: Ibis](../decisions/adrs.md)
