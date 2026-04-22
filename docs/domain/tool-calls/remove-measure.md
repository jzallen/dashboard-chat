# removeMeasure

## Summary

Remove a measure column from the report's `columns_metadata`.

## Context

**Available in:** Report
**Condition:** Report selected

## Parameters

```json
{
  "type": "object",
  "properties": {
    "name": { "type": "string", "description": "Name of the measure to remove" }
  },
  "required": ["name"]
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Name of the measure to remove |

## Preconditions

- Report is selected and active

## Effects

### Immediate
- Reads `columns_metadata` from the report cache
- Filters out entries where `name === args.name && semantic_role === "measure"`
- `PATCH /api/reports/{id}` with the filtered `columns_metadata`

### Asynchronous
- Report detail cache is invalidated

## Error Cases

| Condition | Error |
|-----------|-------|
| Report not found | API 404 |
| Measure with that name does not exist | Silent no-op — filtered list equals current list |

## Idempotency

Idempotent. Removing a non-existent measure is a no-op.

## Related Tools

- [addMeasure](./add-measure.md) — Add a measure
- [removeDimension](./remove-dimension.md) — Remove a dimension with the same name

## Related Entities

- [Report](../entities/report.md)
