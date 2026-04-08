# applyCleaningTransform

## Summary

Persist a previously previewed cleaning operation.

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
      "description": "Target column"
    },
    "operation": {
      "type": "string",
      "enum": ["trim", "upper", "lower", "title", "snake", "kebab", "fill_null", "map_values"],
      "description": "Cleaning operation to apply"
    },
    "config": {
      "type": "object",
      "description": "Operation configuration (e.g., fillValue for fill_null, mappings for map_values)",
      "additionalProperties": true
    }
  },
  "required": ["column", "operation", "config"]
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `column` | enum (column IDs) | Yes | Target column |
| `operation` | enum | Yes | `trim`, `upper`, `lower`, `title`, `snake`, `kebab`, `fill_null`, `map_values` |
| `config` | object | Yes | Operation configuration |

## Preconditions

- Active dataset context with schema available
- A cleaning preview should be active for the specified column and operation
- `column` must be a valid column ID in the active schema

## Effects

### Immediate
- Transform is persisted to the dataset's transform stack
- Preview state is cleared

### Asynchronous
- Table data refreshes with the transform applied
- Transform appears in the dataset's transform history

## Error Cases

| Condition | Error |
|-----------|-------|
| No matching preview active | Transform applied without prior preview (may still succeed) |
| Column ID not in schema | Invalid column reference |
| Invalid operation | Validation error |

## Idempotency

Not idempotent. Each call creates a new transform entry in the stack, even if one with the same params exists.

## Related Tools

- [trimWhitespace](./trim-whitespace.md) — Preview a trim before applying
- [standardizeCase](./standardize-case.md) — Preview a case change before applying
- [fillNulls](./fill-nulls.md) — Preview a fill before applying
- [mapValues](./map-values.md) — Preview a mapping before applying
- [undoCleaningTransform](./undo-cleaning-transform.md) — Undo a persisted transform

## Related Entities

- [Dataset](../entities/dataset.md)
- [Transform](../entities/transform.md)
