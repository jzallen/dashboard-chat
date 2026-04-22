# setMaterialization (Report)

## Summary

Set the report's materialization strategy.

> This is the **report-context** `setMaterialization`. For the view-context equivalent, see [setMaterialization (View)](./set-materialization.md). Same enum values, applied to `Report.materialization` instead of `View.materialization`.

## Context

**Available in:** Report
**Condition:** Report selected

## Parameters

```json
{
  "type": "object",
  "properties": {
    "strategy": {
      "type": "string",
      "enum": ["view", "table", "ephemeral", "incremental"],
      "description": "Materialization strategy"
    }
  },
  "required": ["strategy"]
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `strategy` | enum | Yes | `view`, `table`, `ephemeral`, or `incremental` |

## Preconditions

- Report is selected and active

## Effects

### Immediate
- `PATCH /api/reports/{id}` updates `materialization`

### Asynchronous
- Report detail cache is invalidated
- Generated dbt model config reflects the new strategy on next export

## Error Cases

| Condition | Error |
|-----------|-------|
| Invalid strategy value | Schema validation error |
| `incremental` without a time dimension configured | Accepted at PATCH time; may fail at dbt compile time |

## Idempotency

Idempotent. Setting the same strategy twice produces the same state.

## Related Tools

- [setDomain](./set-domain.md) — Set the report's business domain
- [setReportType](./set-report-type.md) — Fact vs. dimension classification
- [setMaterialization (View)](./set-materialization.md) — View-context equivalent

## Related Entities

- [Report](../entities/report.md)
