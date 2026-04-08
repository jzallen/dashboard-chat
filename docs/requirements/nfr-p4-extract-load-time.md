# NFR-P4: Extract Load Time

## Tag

P4 — Preview: Performance

## Ambition

Load the initial data extract into the browser-side DuckDB WASM engine quickly so dashboards become interactive without a long wait.

## Planguage

| Field | Value |
|-------|-------|
| **Scale** | Time to load the initial data extract from backend into DuckDB WASM |
| **Meter** | Wall-clock from dashboard open to interactive-ready, for extracts under 50MB (Arrow IPC) |
| **Must** | < 10 seconds |
| **Plan** | < 5 seconds |

## Quality Attribute Scenario

| Element | Value |
|---------|-------|
| **Source** | End user |
| **Stimulus** | Opens a dashboard for the first time |
| **Environment** | Normal operation, extract under 50 MB (Arrow IPC) |
| **Artifact** | DuckDB WASM runtime in browser |
| **Response** | System loads the data extract and transitions dashboard to interactive-ready state |
| **Response Measure** | Wall-clock latency < 10 s (Must) / < 5 s (Plan) |

## Status

**Not implemented** — tracked in `local-first-analytics` proposal

## Verification Method

Measure wall-clock time from dashboard open to interactive-ready state for extracts under 50 MB.

## Related

- `local-first-analytics` proposal
