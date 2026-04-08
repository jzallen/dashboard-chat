# renameView

## Summary

Rename the current view.

## Context

**Available in:** View
**Condition:** View selected

## Parameters

```json
{
  "type": "object",
  "properties": {
    "newName": {
      "type": "string",
      "description": "New name for the view"
    }
  },
  "required": ["newName"]
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `newName` | string | Yes | New name for the view |

## Preconditions

- View is selected and active
- `newName` must be unique among existing views

## Effects

### Immediate
- View's name is updated to `newName`

### Asynchronous
- View list refreshes to show the new name
- Any references to this view by name are updated

## Error Cases

| Condition | Error |
|-----------|-------|
| `newName` already used by another view | Duplicate view name |
| `newName` is empty | Validation error |

## Idempotency

Idempotent. Renaming to the same name is a no-op.

## Related Tools

- [createView](./create-view.md) — Create a view
- [deleteView](./delete-view.md) — Delete a view

## Related Entities

- [Dataset](../entities/dataset.md)
