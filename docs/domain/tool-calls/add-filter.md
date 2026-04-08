# addFilter

## Summary

Add a filter condition on the view.

## Context

**Available in:** View
**Condition:** View selected

## Parameters

```json
{
  "type": "object",
  "properties": {
    "sourceRef": {
      "type": "string",
      "description": "Source containing the column"
    },
    "column": {
      "type": "string",
      "description": "Column to filter"
    },
    "operator": {
      "type": "string",
      "enum": ["equals", "notEquals", "contains", "startsWith", "endsWith", "gt", "gte", "lt", "lte", "between", "isNull", "isNotNull"],
      "description": "Comparison operator"
    },
    "value": {
      "description": "Comparison value. Optional for isNull/isNotNull. Array of two for between."
    }
  },
  "required": ["sourceRef", "column", "operator"]
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sourceRef` | string | Yes | Source containing the column |
| `column` | string | Yes | Column to filter |
| `operator` | enum | Yes | `equals`, `notEquals`, `contains`, `startsWith`, `endsWith`, `gt`, `gte`, `lt`, `lte`, `between`, `isNull`, `isNotNull` |
| `value` | any | No | Comparison value. Optional for `isNull`/`isNotNull`. Array of two for `between`. |

## Preconditions

- View is selected and active
- `sourceRef` must be one of the view's configured sources
- `column` must exist in the referenced source
- `value` is required for all operators except `isNull` and `isNotNull`

## Effects

### Immediate
- Filter condition is added to the view's filter list (additive)

### Asynchronous
- View preview refreshes with the filter applied
- Row count updates to reflect the filtered result

## Error Cases

| Condition | Error |
|-----------|-------|
| `sourceRef` not in view's sources | Invalid source reference |
| `column` not in source | Invalid column reference |
| `value` missing for non-null operators | Missing required value |
| `between` operator with non-array value | Invalid value format |

## Idempotency

Not idempotent. Calling twice with the same params adds duplicate filter conditions. Use `removeFilter` followed by `addFilter` to replace.

## Related Tools

- [removeFilter](./remove-filter.md) — Remove a filter from the view
- [filterTable](./filter-table.md) — Dataset-level filtering (different context)

## Related Entities

- [Dataset](../entities/dataset.md)
