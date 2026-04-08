# sortTable

## Summary

Sort the table by a column.

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
      "description": "Column to sort by"
    },
    "direction": {
      "type": "string",
      "enum": ["asc", "desc"],
      "description": "Sort direction"
    }
  },
  "required": ["column", "direction"]
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `column` | enum (column IDs) | Yes | Column to sort by |
| `direction` | enum | Yes | `asc` or `desc` |

## Preconditions

- Active dataset context with schema available
- `column` must be a valid column ID in the active schema

## Effects

### Immediate
- Sort state updated to the specified column and direction
- Replaces any existing sort (single-column sort)

### Asynchronous
- Table preview refreshes with sorted data

## Error Cases

| Condition | Error |
|-----------|-------|
| Column ID not in schema | Invalid column reference |
| Invalid direction value | Validation error |

## Idempotency

Idempotent. Calling twice with the same params produces the same sort state.

## Related Tools

- [clearSort](./clear-sort.md) — Remove sorting
- [filterTable](./filter-table.md) — Filter after sorting

## Related Entities

- [Dataset](../entities/dataset.md)
