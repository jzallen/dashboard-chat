# fillNulls

## Summary

Fill null or empty values with a specified value.

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
      "description": "Column to fill"
    },
    "fillValue": {
      "type": "string",
      "description": "Replacement value for nulls and empty values"
    }
  },
  "required": ["column", "fillValue"]
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `column` | enum (column IDs) | Yes | Column to fill |
| `fillValue` | string | Yes | Replacement value |

## Preconditions

- Active dataset context with schema available
- `column` must be a valid column ID in the active schema

## Effects

### Immediate
- Produces a preview showing null/empty values replaced with `fillValue`

### Asynchronous
- Preview refreshes to show before/after comparison
- Must be paired with `applyCleaningTransform` to persist the change

## Error Cases

| Condition | Error |
|-----------|-------|
| Column ID not in schema | Invalid column reference |
| Column has no null values | Preview shows no changes (not an error) |

## Idempotency

Safe to call multiple times. Each call regenerates the preview. Not persisted until `applyCleaningTransform` is called.

## Related Tools

- [applyCleaningTransform](./apply-cleaning-transform.md) — Persist the previewed fill operation
- [mapValues](./map-values.md) — Map specific values (not just nulls)
- [undoCleaningTransform](./undo-cleaning-transform.md) — Undo after applying

## Related Entities

- [Dataset](../entities/dataset.md)
- [Transform](../entities/transform.md)
