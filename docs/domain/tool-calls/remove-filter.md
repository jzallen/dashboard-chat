# removeFilter

## Summary

Remove a filter from the view.

## Context

**Available in:** View
**Condition:** View selected

## Parameters

```json
{
  "type": "object",
  "properties": {
    "sourceRef": {
      "type": "string",
      "description": "Source of the filtered column"
    },
    "column": {
      "type": "string",
      "description": "Column to remove filter from"
    }
  },
  "required": ["sourceRef", "column"]
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sourceRef` | string | Yes | Source of the filtered column |
| `column` | string | Yes | Column to remove filter from |

## Preconditions

- View is selected and active
- A filter on the specified `sourceRef` + `column` combination must exist

## Effects

### Immediate
- All filter conditions on the specified source/column combination are removed

### Asynchronous
- View preview refreshes without the removed filter
- Row count updates

## Error Cases

| Condition | Error |
|-----------|-------|
| No filter exists for the specified source/column | Filter not found |
| `sourceRef` not in view's sources | Invalid source reference |

## Idempotency

Not idempotent. The second call fails because the filter no longer exists.

## Related Tools

- [addFilter](./add-filter.md) — Add a filter to the view
- [clearFilters](./clear-filters.md) — Dataset-level clear (different context)

## Related Entities

- [Dataset](../entities/dataset.md)
