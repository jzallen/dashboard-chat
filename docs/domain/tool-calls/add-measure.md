# addMeasure

## Summary

Add a measure column to the report's `columns_metadata`. Measures are numeric aggregations.

## Context

**Available in:** Report
**Condition:** Report selected

## Parameters

```json
{
  "type": "object",
  "properties": {
    "name": { "type": "string", "description": "Column name" },
    "semanticType": {
      "type": "string",
      "enum": ["sum", "count", "count_distinct", "avg", "min", "max"]
    },
    "description": { "type": "string" },
    "expr": { "type": "string", "description": "Optional SQL expression for the measure" }
  },
  "required": ["name", "semanticType"]
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Column name |
| `semanticType` | enum | Yes | Aggregation type: `sum`, `count`, `count_distinct`, `avg`, `min`, `max` |
| `description` | string | No | Column description |
| `expr` | string | No | Optional SQL expression for the measure |

## Preconditions

- Report is selected and active

## Effects

### Immediate
- Reads current `columns_metadata` from the report cache
- Appends a new `{ name, semantic_role: "measure", semantic_type, description, expr }` entry
- `PATCH /api/reports/{id}` with the updated `columns_metadata`

### Asynchronous
- Report detail cache is invalidated — Columns Metadata table refreshes

## Error Cases

| Condition | Error |
|-----------|-------|
| Report not found | API 404 |
| Invalid `semanticType` (not one of the 6 aggregation types) | Schema validation error |

## Idempotency

Not idempotent. Calling twice appends the measure twice.

## Related Tools

- [removeMeasure](./remove-measure.md) — Remove a measure
- [addDimension](./add-dimension.md) — Add a grouping attribute instead
- [suggestStructure](./suggest-structure.md) — Propose measures from source columns

## Related Entities

- [Report](../entities/report.md)
