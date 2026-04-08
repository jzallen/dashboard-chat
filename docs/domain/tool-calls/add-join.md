# addJoin

## Summary

Add a join between sources in the view.

## Context

**Available in:** View
**Condition:** View selected

## Parameters

```json
{
  "type": "object",
  "properties": {
    "rightRef": {
      "type": "string",
      "description": "Right-side source name"
    },
    "leftColumn": {
      "type": "string",
      "description": "Left join column"
    },
    "rightColumn": {
      "type": "string",
      "description": "Right join column"
    },
    "joinType": {
      "type": "string",
      "enum": ["INNER", "LEFT", "RIGHT", "FULL"],
      "default": "INNER",
      "description": "Join type (default: INNER)"
    }
  },
  "required": ["rightRef", "leftColumn", "rightColumn"]
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `rightRef` | string | Yes | Right-side source name |
| `leftColumn` | string | Yes | Left join column |
| `rightColumn` | string | Yes | Right join column |
| `joinType` | enum | No | `INNER`, `LEFT`, `RIGHT`, `FULL` (default: `INNER`) |

## Preconditions

- View is selected and active
- `rightRef` must be one of the view's configured sources
- `leftColumn` must exist in the left (primary) source
- `rightColumn` must exist in the right source
- No existing join on `rightRef` (one join per right-side source)

## Effects

### Immediate
- Join definition is added to the view's join list

### Asynchronous
- View preview refreshes with joined data
- Column availability may change based on join results

## Error Cases

| Condition | Error |
|-----------|-------|
| `rightRef` not in view's sources | Invalid source reference |
| Join already exists for `rightRef` | Duplicate join on same source |
| `leftColumn` or `rightColumn` not found | Invalid column reference |
| Join produces empty result set | Not an error, but preview shows no rows |

## Idempotency

Not idempotent. A duplicate join on the same `rightRef` would fail.

## Related Tools

- [removeJoin](./remove-join.md) — Remove a join
- [createView](./create-view.md) — Create view with multiple sources first
- [addColumn](./add-column.md) — Add columns from the joined source

## Related Entities

- [Dataset](../entities/dataset.md)
