# renameColumn

## Summary

Rename a column's display name by creating an alias. Applies immediately without preview.

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
      "description": "Column to rename"
    },
    "newName": {
      "type": "string",
      "description": "New display name"
    }
  },
  "required": ["column", "newName"]
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `column` | enum (column IDs) | Yes | Column to rename |
| `newName` | string | Yes | New display name |

## Preconditions

- Active dataset context with schema available
- `column` must be a valid column ID in the active schema

## Effects

### Immediate
- Column alias is created or updated — applies immediately without preview
- This is the exception among cleaning tools: no preview/apply workflow required

### Asynchronous
- Table header refreshes to show the new column name

## Error Cases

| Condition | Error |
|-----------|-------|
| Column ID not in schema | Invalid column reference |
| `newName` conflicts with existing column name | Name collision |
| `newName` is empty | Validation error |

## Idempotency

Idempotent. Calling twice with the same params produces the same alias.

## Related Tools

- [trimWhitespace](./trim-whitespace.md) — Clean column data (requires preview)
- [standardizeCase](./standardize-case.md) — Standardize column data (requires preview)

## Related Entities

- [Dataset](../entities/dataset.md)
- [Transform](../entities/transform.md)
