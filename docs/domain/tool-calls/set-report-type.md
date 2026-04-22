# setReportType

## Summary

Set the report type: `fact` for metrics/events, `dimension` for descriptive attributes.

## Context

**Available in:** Report
**Condition:** Report selected

## Parameters

```json
{
  "type": "object",
  "properties": {
    "reportType": { "type": "string", "enum": ["fact", "dimension"] }
  },
  "required": ["reportType"]
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `reportType` | enum | Yes | `fact` or `dimension` |

## Preconditions

- Report is selected and active

## Effects

### Immediate
- `PATCH /api/reports/{id}` updates `report_type`

### Asynchronous
- Report detail cache is invalidated — report type badge refreshes

## Error Cases

| Condition | Error |
|-----------|-------|
| Report not found | API 404 |
| Invalid type value | Schema validation error |

## Idempotency

Idempotent. Setting the same type twice produces the same state.

## Related Tools

- [setDomain](./set-domain.md) — Set the business domain
- [setMaterialization (Report)](./report-set-materialization.md) — Materialization strategy

## Related Entities

- [Report](../entities/report.md)
