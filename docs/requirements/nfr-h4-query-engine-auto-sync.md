# NFR-H4: Query Engine Auto-Sync

## Tag

H4 — Handoff: Performance

## Ambition

Keep the external query engine automatically synchronized with dataset and transform changes so users always query current data.

## Planguage

| Field | Value |
|-------|-------|
| **Scale** | Time from dataset/transform change to query engine view update |
| **Meter** | Elapsed time between outbox event and foreign table refresh |
| **Must** | < 60 seconds |
| **Plan** | < 30 seconds |

## Quality Attribute Scenario

| Element | Value |
|---------|-------|
| **Source** | System (outbox event) |
| **Stimulus** | A dataset or transform is created/updated |
| **Environment** | Normal operation |
| **Artifact** | Query engine sync worker (outbox pattern) |
| **Response** | System refreshes foreign tables in the query engine |
| **Response Measure** | Elapsed time from outbox event to view update < 60 s (Must) / < 30 s (Plan) |

## Status

**Implemented** — event-driven sync via outbox pattern

## Verification Method

Measure elapsed time between a dataset/transform change and the corresponding foreign table refresh in the query engine.

## Related

- External Access entity
- Outbox pattern
