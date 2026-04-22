# createReport

## Summary

Create a new report (mart-layer dbt model — fact or dimension) from one or more source datasets or views.

## Context

**Available in:** Report
**Condition:** Any report context (no existing report required)

## Parameters

```json
{
  "type": "object",
  "properties": {
    "name": { "type": "string", "description": "Name for the new report" },
    "sqlDefinition": { "type": "string", "description": "SQL query defining the report" },
    "reportType": { "type": "string", "enum": ["fact", "dimension"] },
    "sourceRefs": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "type": { "type": "string", "enum": ["dataset", "view"] }
        },
        "required": ["id", "type"]
      }
    },
    "domain": { "type": "string", "description": "Business domain (e.g. 'Finance')" },
    "description": { "type": "string" },
    "materialization": { "type": "string", "enum": ["view", "table", "ephemeral", "incremental"] }
  },
  "required": ["name", "sqlDefinition", "reportType", "sourceRefs", "domain"]
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Name for the new report |
| `sqlDefinition` | string | Yes | SQL query defining the report |
| `reportType` | enum | Yes | `fact` for metrics/events, `dimension` for descriptive attributes |
| `sourceRefs` | array | Yes | Sources — each `{ id, type }` where `type` is `dataset` or `view` (never `report`) |
| `domain` | string | Yes | Business domain |
| `description` | string | No | Optional description |
| `materialization` | enum | No | `view` (default), `table`, `ephemeral`, or `incremental` |

## Preconditions

- Each `sourceRefs[].id` must resolve to an existing dataset or view in the current project
- `sourceRefs[].type` must be `dataset` or `view` — **never** `report` (no mart-to-mart references)

## Effects

### Immediate
- `POST /api/reports` creates the new report with the supplied fields
- Chat context switches to the new report (`setContext("report", report.id)`)
- Browser navigates to `/report/{id}`

### Asynchronous
- Report list cache is invalidated for the current project

## Error Cases

| Condition | Error |
|-----------|-------|
| `sourceRefs[].type` is `report` | Rejected — reports cannot reference other reports |
| Source ID does not exist | API error from backend |
| Invalid SQL definition | API error from backend |

## Idempotency

Not idempotent. Calling twice with the same params creates two reports.

## Related Tools

- [renameReport](./rename-report.md) — Rename after creation
- [deleteReport](./delete-report.md) — Remove the report
- [suggestStructure](./suggest-structure.md) — Analyze source columns for dimension/measure assignment

## Related Entities

- [Report](../entities/report.md)
