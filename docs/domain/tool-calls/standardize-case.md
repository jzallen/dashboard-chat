# standardizeCase

## Summary

Standardize text casing in a column.

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
      "enum": ["<dynamic: text column IDs from active dataset schema>"],
      "description": "Column to standardize"
    },
    "mode": {
      "type": "string",
      "enum": ["upper", "lower", "title", "snake", "kebab"],
      "description": "Target casing mode"
    }
  },
  "required": ["column", "mode"]
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `column` | enum (text columns) | Yes | Column to standardize |
| `mode` | enum | Yes | `upper`, `lower`, `title`, `snake`, `kebab` |

## Preconditions

- Active dataset context with schema available
- `column` must be a text-typed column in the active schema

## Effects

### Immediate
- Produces a preview showing the column with standardized casing

### Asynchronous
- Preview refreshes to show before/after comparison
- Must be paired with `applyCleaningTransform` to persist the change

## Error Cases

| Condition | Error |
|-----------|-------|
| Column is not text type | Type mismatch — only text columns supported |
| Column ID not in schema | Invalid column reference |

## Idempotency

Safe to call multiple times. Each call regenerates the preview with the specified mode. Not persisted until `applyCleaningTransform` is called.

## Related Tools

- [applyCleaningTransform](./apply-cleaning-transform.md) — Persist the previewed case standardization
- [trimWhitespace](./trim-whitespace.md) — Another text cleaning operation
- [undoCleaningTransform](./undo-cleaning-transform.md) — Undo after applying

## Related Entities

- [Dataset](../entities/dataset.md)
- [Transform](../entities/transform.md)
