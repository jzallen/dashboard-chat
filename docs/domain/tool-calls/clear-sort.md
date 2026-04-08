# clearSort

## Summary

Remove current sorting from the table.

## Context

**Available in:** Dataset
**Condition:** Dataset selected, schema available

## Parameters

No parameters required.

```json
{
  "type": "object",
  "properties": {},
  "required": []
}
```

## Preconditions

- Active dataset context with schema available

## Effects

### Immediate
- Sort state is cleared; table returns to default row order

### Asynchronous
- Table preview refreshes in default order

## Error Cases

| Condition | Error |
|-----------|-------|
| No sort active | No-op; completes successfully |

## Idempotency

Idempotent. Calling when no sort is active is a safe no-op.

## Related Tools

- [sortTable](./sort-table.md) — Apply sorting

## Related Entities

- [Dataset](../entities/dataset.md)
