# setGrain

## Summary

Set the view's grain by specifying a time dimension and grouping dimensions.

## Context

**Available in:** View
**Condition:** View selected

## Parameters

```json
{
  "type": "object",
  "properties": {
    "timeColumn": {
      "type": "string",
      "description": "Time-typed column to use as the time dimension"
    },
    "dimensions": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Dimension columns for grouping"
    }
  },
  "required": ["timeColumn", "dimensions"]
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `timeColumn` | string | Yes | Time-typed column |
| `dimensions` | string[] | Yes | Dimension columns |

## Preconditions

- View is selected and active
- `timeColumn` must reference a column with a time-compatible display type (`date`, `time`, or `datetime`)
- All `dimensions` must reference existing columns in the view

## Effects

### Immediate
- View's grain configuration is updated with the time dimension and grouping dimensions

### Asynchronous
- View preview refreshes with aggregated/grouped data
- Materialization behavior may change (especially for `incremental` strategy)

## Error Cases

| Condition | Error |
|-----------|-------|
| `timeColumn` not a time-typed column | Type mismatch — must be date, time, or datetime |
| Dimension column not in view | Invalid column reference |
| Empty dimensions array | At least one dimension required (or implementation-specific) |

## Idempotency

Idempotent. Setting the same grain configuration twice produces the same state.

## Related Tools

- [setMaterialization](./set-materialization.md) — Often paired with grain for incremental models
- [castColumn](./cast-column.md) — May need to cast column to time type first
- [addColumn](./add-column.md) — Add columns to use as dimensions

## Related Entities

- [Dataset](../entities/dataset.md)
