# removeJoin

## Summary

Remove a join by right-side source name.

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
      "description": "Right-side source name identifying the join to remove"
    }
  },
  "required": ["rightRef"]
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `rightRef` | string | Yes | Right-side source name identifying the join to remove |

## Preconditions

- View is selected and active
- A join with the specified `rightRef` must exist in the view

## Effects

### Immediate
- Join definition for `rightRef` is removed from the view's join list

### Asynchronous
- View preview refreshes without the removed join
- Columns from the right-side source may become unavailable if no other join references them

## Error Cases

| Condition | Error |
|-----------|-------|
| No join exists for `rightRef` | Join not found |
| `rightRef` not in view's sources | Invalid source reference |

## Idempotency

Not idempotent. The second call fails because the join no longer exists.

## Related Tools

- [addJoin](./add-join.md) — Add a join between sources
- [removeColumn](./remove-column.md) — May need to remove columns from the unjoined source

## Related Entities

- [Dataset](../entities/dataset.md)
