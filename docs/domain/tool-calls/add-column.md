# addColumn

## Summary

Add a column to the view from a source.

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
      "description": "Source name"
    },
    "sourceColumn": {
      "type": "string",
      "description": "Column in the source"
    },
    "displayType": {
      "type": "string",
      "enum": ["text", "category", "id", "serial", "integer", "decimal", "boolean", "date", "time", "datetime"],
      "description": "Display type for the column"
    },
    "alias": {
      "type": "string",
      "description": "Optional display alias for the column"
    }
  },
  "required": ["sourceRef", "sourceColumn", "displayType"]
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sourceRef` | string | Yes | Source name |
| `sourceColumn` | string | Yes | Column in the source |
| `displayType` | enum | Yes | `text`, `category`, `id`, `serial`, `integer`, `decimal`, `boolean`, `date`, `time`, `datetime` |
| `alias` | string | No | Optional display alias |

## Preconditions

- View is selected and active
- `sourceRef` must be one of the view's configured sources
- `sourceColumn` must exist in the referenced source

## Effects

### Immediate
- Column is added to the view's column list

### Asynchronous
- View preview refreshes to include the new column
- Column appears in the view's schema

## Error Cases

| Condition | Error |
|-----------|-------|
| `sourceRef` not in view's sources | Invalid source reference |
| `sourceColumn` not in source | Invalid column reference |
| Column already added with same source and name | Duplicate column |

## Idempotency

Not idempotent. Adding the same column twice would create a duplicate (or fail on duplicate check).

## Related Tools

- [removeColumn](./remove-column.md) — Remove a column from the view
- [castColumn](./cast-column.md) — Change a column's display type after adding
- [createView](./create-view.md) — Create the view first

## Related Entities

- [Dataset](../entities/dataset.md)
