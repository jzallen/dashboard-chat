# deleteView

## Summary

Delete a view by ID.

## Context

**Available in:** View
**Condition:** View selected

## Parameters

```json
{
  "type": "object",
  "properties": {
    "viewId": {
      "type": "string",
      "description": "ID of the view to delete"
    }
  },
  "required": ["viewId"]
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `viewId` | string | Yes | ID of the view to delete |

## Preconditions

- View context is active
- `viewId` must reference an existing view

## Effects

### Immediate
- View entity is deleted
- If the deleted view was the active view, context resets

### Asynchronous
- View list refreshes without the deleted view
- Any views that referenced this view as a source may become invalid

## Error Cases

| Condition | Error |
|-----------|-------|
| `viewId` not found | View not found |
| View is referenced as a source by other views | Dependency conflict (implementation-specific) |

## Idempotency

Not idempotent. The second call fails because the view no longer exists.

## Related Tools

- [createView](./create-view.md) — Create a new view
- [renameView](./rename-view.md) — Rename instead of deleting

## Related Entities

- [Dataset](../entities/dataset.md)
