# castColumn

## Summary

Change a column's display type.

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
      "description": "Column to cast"
    },
    "displayType": {
      "type": "string",
      "enum": ["text", "category", "id", "serial", "integer", "decimal", "boolean", "date", "time", "datetime"],
      "description": "New display type"
    }
  },
  "required": ["columnName", "displayType"]
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `columnName` | string | Yes | Column to cast |
| `displayType` | enum | Yes | `text`, `category`, `id`, `serial`, `integer`, `decimal`, `boolean`, `date`, `time`, `datetime` |

## Preconditions

- View is selected and active
- `columnName` must reference an existing column in the view

## Effects

### Immediate
- Column's display type metadata is updated

### Asynchronous
- View preview refreshes with the new type applied
- Column rendering may change (e.g., formatting, sort behavior)

## Error Cases

| Condition | Error |
|-----------|-------|
| Column not in view | Invalid column reference |
| Incompatible cast (e.g., text to integer with non-numeric data) | Cast error on preview |

## Idempotency

Idempotent. Casting to the same type is a no-op.

## Related Tools

- [addColumn](./add-column.md) — Set display type when adding a column
- [removeColumn](./remove-column.md) — Remove column instead of changing type

## Related Entities

- [Dataset](../entities/dataset.md)
