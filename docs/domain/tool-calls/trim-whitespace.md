# trimWhitespace

## Summary

Trim leading and trailing whitespace from a text column.

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
      "description": "Column to trim"
    }
  },
  "required": ["column"]
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `column` | enum (text columns) | Yes | Column to trim |

## Preconditions

- Active dataset context with schema available
- `column` must be a text-typed column in the active schema

## Effects

### Immediate
- Produces a preview showing the column with whitespace trimmed

### Asynchronous
- Preview refreshes to show before/after comparison
- Must be paired with `applyCleaningTransform` to persist the change

## Error Cases

| Condition | Error |
|-----------|-------|
| Column is not text type | Type mismatch — only text columns supported |
| Column ID not in schema | Invalid column reference |

## Idempotency

Safe to call multiple times. Each call regenerates the preview. The transform is not persisted until `applyCleaningTransform` is called.

## Related Tools

- [applyCleaningTransform](./apply-cleaning-transform.md) — Persist the previewed trim operation
- [standardizeCase](./standardize-case.md) — Another text cleaning operation
- [undoCleaningTransform](./undo-cleaning-transform.md) — Undo after applying

## Related Entities

- [Dataset](../entities/dataset.md)
- [Transform](../entities/transform.md)
