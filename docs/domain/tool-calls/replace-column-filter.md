# replaceColumnFilter

## Summary

Replace all existing filters on a column with new conditions, preserving filters on other columns.

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
      "description": "Column to replace filters on"
    },
    "filters": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "operator": {
            "type": "string",
            "enum": ["equals", "notEquals", "contains", "startsWith", "endsWith", "gt", "gte", "lt", "lte", "between"]
          },
          "value": {
            "description": "Comparison value"
          }
        },
        "required": ["operator", "value"]
      },
      "description": "Array of {operator, value} objects"
    }
  },
  "required": ["column", "filters"]
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `column` | enum (column IDs) | Yes | Column to replace filters on |
| `filters` | array | Yes | Array of `{operator, value}` objects |

## Preconditions

- Active dataset context with schema available
- `column` must be a valid column ID in the active schema

## Effects

### Immediate
- All existing filters on the specified column are removed
- New filter conditions from `filters` array are applied
- Filters on other columns are preserved

### Asynchronous
- Table preview refreshes with updated filter state

## Error Cases

| Condition | Error |
|-----------|-------|
| Column ID not in schema | Invalid column reference |
| Empty filters array | Effectively clears filters on that column |
| Invalid operator in a filter entry | Validation error |

## Idempotency

Idempotent. Calling twice with the same params produces the same filter state.

## Related Tools

- [filterTable](./filter-table.md) — Add a single filter (additive)
- [clearFilters](./clear-filters.md) — Remove all filters on all columns

## Related Entities

- [Dataset](../entities/dataset.md)
