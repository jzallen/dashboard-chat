# removeDimension

## Summary

Remove a dimension column from the report's `columns_metadata`.

## Context

**Available in:** Report
**Condition:** Report selected

## Parameters

```json
{
  "type": "object",
  "properties": {
    "name": { "type": "string", "description": "Name of the dimension to remove" }
  },
  "required": ["name"]
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Name of the dimension to remove |

## Preconditions

- Report is selected and active

## Effects

### Immediate
- Reads `columns_metadata` from the report cache
- Filters out entries where `name === args.name && semantic_role === "dimension"`
- `PATCH /api/reports/{id}` with the filtered `columns_metadata`

### Asynchronous
- Report detail cache is invalidated

## Error Cases

| Condition | Error |
|-----------|-------|
| Report not found | API 404 |
| Dimension with that name does not exist | Silent no-op — filtered list equals current list |

## Idempotency

Idempotent. Removing a non-existent dimension is a no-op.

## Related Tools

- [addDimension](./add-dimension.md) — Add a dimension
- [removeMeasure](./remove-measure.md) — Remove a measure with the same name (different `semantic_role`)

## Related Entities

- [Report](../entities/report.md)
