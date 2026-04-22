# setDomain

## Summary

Set the business domain for the report (e.g. `Finance`, `Sales`, `Clinical`).

## Context

**Available in:** Report
**Condition:** Report selected

## Parameters

```json
{
  "type": "object",
  "properties": {
    "domain": { "type": "string", "description": "Business domain name" }
  },
  "required": ["domain"]
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `domain` | string | Yes | Business domain name |

## Preconditions

- Report is selected and active

## Effects

### Immediate
- `PATCH /api/reports/{id}` updates `domain`

### Asynchronous
- Report detail cache is invalidated — domain badge refreshes

## Error Cases

| Condition | Error |
|-----------|-------|
| Report not found | API 404 |

## Idempotency

Idempotent. Setting the same domain twice produces the same state.

## Related Tools

- [setReportType](./set-report-type.md) — Fact vs. dimension classification
- [setMaterialization (Report)](./report-set-materialization.md) — Materialization strategy

## Related Entities

- [Report](../entities/report.md)
