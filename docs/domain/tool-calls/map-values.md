# mapValues

## Summary

Map specific values to new values using exact match replacement.

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
      "description": "Column to map"
    },
    "mappings": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "from": {
            "type": "string",
            "description": "Original value to match (exact)"
          },
          "to": {
            "type": "string",
            "description": "Replacement value"
          }
        },
        "required": ["from", "to"]
      },
      "description": "Array of {from, to} mapping objects"
    }
  },
  "required": ["column", "mappings"]
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `column` | enum (text columns) | Yes | Column to map |
| `mappings` | array | Yes | Array of `{from, to}` objects |

## Preconditions

- Active dataset context with schema available
- `column` must be a text-typed column in the active schema
- `mappings` must have at least one entry

## Effects

### Immediate
- Produces a preview showing values replaced according to the mappings

### Asynchronous
- Preview refreshes to show before/after comparison
- Must be paired with `applyCleaningTransform` to persist the change

## Error Cases

| Condition | Error |
|-----------|-------|
| Column is not text type | Type mismatch — only text columns supported |
| Column ID not in schema | Invalid column reference |
| Empty mappings array | Validation error |
| No values match any mapping | Preview shows no changes (not an error) |

## Idempotency

Safe to call multiple times. Each call regenerates the preview. Not persisted until `applyCleaningTransform` is called.

## Related Tools

- [applyCleaningTransform](./apply-cleaning-transform.md) — Persist the previewed mapping
- [fillNulls](./fill-nulls.md) — Simpler replacement for null values only
- [undoCleaningTransform](./undo-cleaning-transform.md) — Undo after applying

## Related Entities

- [Dataset](../entities/dataset.md)
- [Transform](../entities/transform.md)
