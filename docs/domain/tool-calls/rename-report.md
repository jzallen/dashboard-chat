# renameReport

## Summary

Rename the current report.

## Context

**Available in:** Report
**Condition:** Report selected

## Parameters

```json
{
  "type": "object",
  "properties": {
    "newName": { "type": "string", "description": "New name for the report" }
  },
  "required": ["newName"]
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `newName` | string | Yes | New name for the report |

## Preconditions

- Report is selected and active

## Effects

### Immediate
- `PATCH /api/reports/{id}` updates `name`

### Asynchronous
- Report detail cache is invalidated — detail page refreshes with the new name

## Error Cases

| Condition | Error |
|-----------|-------|
| Report not found | API 404 |
| Name fails backend validation | API error |

## Idempotency

Idempotent. Renaming to the same name is a no-op from the user's perspective.

## Related Tools

- [createReport](./create-report.md) — Create the report first
- [deleteReport](./delete-report.md) — Remove the report

## Related Entities

- [Report](../entities/report.md)
