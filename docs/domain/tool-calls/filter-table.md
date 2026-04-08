# filterTable

## Summary

Add a filter condition to the table.

## Context

**Available in:** Dataset
**Condition:** Dataset selected, schema available

## Parameters

```json
{
  "type": "object",
  "properties": {
    "column": {
      "type": "string",
      "enum": ["<dynamic: column IDs from active dataset schema>"],
      "description": "Column to filter by"
    },
    "operator": {
      "type": "string",
      "enum": ["equals", "notEquals", "contains", "startsWith", "endsWith", "gt", "gte", "lt", "lte", "between"],
      "description": "Comparison operator"
    },
    "value": {
      "description": "Comparison value. Array of two numbers for `between`."
    }
  },
  "required": ["column", "operator", "value"]
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `column` | enum (column IDs) | Yes | Column to filter by |
| `operator` | enum | Yes | `equals`, `notEquals`, `contains`, `startsWith`, `endsWith`, `gt`, `gte`, `lt`, `lte`, `between` |
| `value` | any | Yes | Comparison value. Array of two numbers for `between`. |

## Preconditions

- Active dataset context with schema available
- `column` must be a valid column ID in the active schema
- `operator` must be compatible with the column's data type

## Effects

### Immediate
- Filter condition added to table state (additive — does not replace existing filters)

### Asynchronous
- Table preview refreshes with filtered data
- Row count updates to reflect filtered subset

## Error Cases

| Condition | Error |
|-----------|-------|
| Column ID not in schema | Invalid column reference |
| Operator incompatible with column type | Type mismatch error |
| `between` operator with non-array value | Invalid value format |

## Idempotency

Not idempotent. Calling twice with the same params adds duplicate filter conditions. Use `replaceColumnFilter` to set exact filter state.

## Related Tools

- [replaceColumnFilter](./replace-column-filter.md) — Replace all filters on a column instead of adding
- [clearFilters](./clear-filters.md) — Remove all filters
- [sortTable](./sort-table.md) — Sort after filtering

## Related Entities

- [Dataset](../entities/dataset.md)
