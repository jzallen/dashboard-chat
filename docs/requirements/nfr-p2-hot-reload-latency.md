# NFR-P2: Hot Reload Latency

## Tag

P2 — Preview: Performance

## Ambition

Enable rapid iterative refinement of dashboards by keeping the time from a chat-based change to an updated preview short.

## Planguage

| Field | Value |
|-------|-------|
| **Scale** | Time from natural language refinement to updated preview in the dashboard tab |
| **Meter** | Wall-clock from chat submission to re-rendered preview |
| **Must** | < 30 seconds (incremental changes should be faster than full generation) |
| **Plan** | < 15 seconds |

## Quality Attribute Scenario

| Element | Value |
|---------|-------|
| **Source** | End user |
| **Stimulus** | Submits a natural language refinement to an existing dashboard |
| **Environment** | Normal operation, dashboard already generated |
| **Artifact** | Preview tab hot-reload mechanism |
| **Response** | System applies incremental change and re-renders the dashboard preview |
| **Response Measure** | Wall-clock latency < 30 s (Must) / < 15 s (Plan) |

## Status

**Not implemented** — preview tab and hot-reload mechanism not yet built

## Verification Method

Measure wall-clock time from chat refinement submission to re-rendered preview for incremental dashboard changes.

## Related

- `planner-docker-integration` proposal
