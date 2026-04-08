# clearFilters

## Summary

Remove all active filters from the table.

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
- All filter conditions are removed from the table state

### Asynchronous
- Table preview refreshes showing unfiltered data
- Row count returns to total dataset count

## Error Cases

| Condition | Error |
|-----------|-------|
| No filters active | No-op; completes successfully |

## Idempotency

Idempotent. Calling when no filters are active is a safe no-op.

## Related Tools

- [filterTable](./filter-table.md) — Add a filter
- [replaceColumnFilter](./replace-column-filter.md) — Replace filters on a specific column

## Related Entities

- [Dataset](../entities/dataset.md)
