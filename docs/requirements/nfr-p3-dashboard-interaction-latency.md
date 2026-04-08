# NFR-P3: Dashboard Interaction Latency (Local-First)

## Tag

P3 — Preview: Performance

## Ambition

Deliver near-instantaneous dashboard interactions by executing queries locally in the browser via DuckDB WASM.

## Planguage

| Field | Value |
|-------|-------|
| **Scale** | Time from user interaction (filter click, drill-down, time range change) to updated chart in preview |
| **Meter** | P95 measured in browser on datasets with pre-loaded DuckDB WASM extract |
| **Must** | < 100 ms |
| **Plan** | < 10 ms |

## Quality Attribute Scenario

| Element | Value |
|---------|-------|
| **Source** | End user |
| **Stimulus** | Performs an interaction (filter click, drill-down, time range change) on a dashboard |
| **Environment** | Normal operation, data extract pre-loaded in DuckDB WASM |
| **Artifact** | DuckDB WASM runtime in browser |
| **Response** | System re-executes query locally and updates the chart |
| **Response Measure** | P95 interaction-to-render latency < 100 ms (Must) / < 10 ms (Plan) |

## Status

**Not implemented** — DuckDB WASM runtime not yet built. Tracked in `local-first-analytics` proposal.

## Verification Method

Measure P95 latency from user interaction to chart update in the browser with a pre-loaded DuckDB WASM extract.

## Related

- [ADR-003: DuckDB WASM](../decisions/adrs.md)
- `local-first-analytics` proposal
