# removeColumn

## Summary

Remove a column from the view.

## Context

**Available in:** View
**Condition:** View selected

## Parameters

```json
{
  "type": "object",
  "properties": {
    "columnName": {
      "type": "string",
      "description": "Column to remove (by name or alias)"
    }
  },
  "required": ["columnName"]
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `columnName` | string | Yes | Column to remove |

## Preconditions

- View is selected and active
- `columnName` must reference an existing column in the view

## Effects

### Immediate
- Column is removed from the view's column list

### Asynchronous
- View preview refreshes without the removed column

## Error Cases

| Condition | Error |
|-----------|-------|
| Column not in view | Invalid column reference |
| Removing the last column | View must retain at least one column (or implementation-specific) |

## Idempotency

Not idempotent. The second call fails because the column no longer exists.

## Related Tools

- [addColumn](./add-column.md) — Add a column to the view
- [castColumn](./cast-column.md) — Change column type instead of removing

## Related Entities

- [Dataset](../entities/dataset.md)
