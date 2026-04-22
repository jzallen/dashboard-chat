# addDimension

## Summary

Add a dimension column to the report's `columns_metadata`. Dimensions are categorical or time-based grouping attributes.

## Context

**Available in:** Report
**Condition:** Report selected

## Parameters

```json
{
  "type": "object",
  "properties": {
    "name": { "type": "string", "description": "Column name" },
    "semanticType": { "type": "string", "enum": ["categorical", "time"] },
    "description": { "type": "string" },
    "expr": { "type": "string", "description": "Optional SQL expression" },
    "timeGranularity": { "type": "string", "enum": ["day", "week", "month", "quarter", "year"] }
  },
  "required": ["name", "semanticType"]
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Column name |
| `semanticType` | enum | Yes | `categorical` or `time` |
| `description` | string | No | Column description |
| `expr` | string | No | Optional SQL expression |
| `timeGranularity` | enum | No | `day`, `week`, `month`, `quarter`, or `year` — required in practice for `time` dimensions |

## Preconditions

- Report is selected and active
- `name` should not already exist as a dimension (no de-duplication is performed — duplicates are appended)

## Effects

### Immediate
- Reads current `columns_metadata` from the report cache
- Appends a new `{ name, semantic_role: "dimension", semantic_type, description, expr, time_granularity }` entry
- `PATCH /api/reports/{id}` with the updated `columns_metadata`

### Asynchronous
- Report detail cache is invalidated — Columns Metadata table refreshes

## Error Cases

| Condition | Error |
|-----------|-------|
| Report not found | API 404 |
| Invalid `semanticType` | Schema validation error |
| `timeGranularity` passed for non-time dimension | Accepted but ignored by most consumers |

## Idempotency

Not idempotent. Calling twice appends the dimension twice.

## Related Tools

- [removeDimension](./remove-dimension.md) — Remove a dimension
- [addMeasure](./add-measure.md) — Add a numeric aggregation instead
- [suggestStructure](./suggest-structure.md) — Propose dimensions from source columns

## Related Entities

- [Report](../entities/report.md)
