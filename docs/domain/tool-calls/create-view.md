# createView

## Summary

Create a new view from source datasets or views.

## Context

**Available in:** View
**Condition:** View context active

## Parameters

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "View name"
    },
    "sourceRefs": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Source dataset/view names"
    },
    "description": {
      "type": "string",
      "description": "Optional description of the view's purpose"
    }
  },
  "required": ["name", "sourceRefs"]
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | View name |
| `sourceRefs` | string[] | Yes | Source dataset/view names |
| `description` | string | No | Optional description |

## Preconditions

- View context is active
- `sourceRefs` must reference existing datasets or views
- `name` must be unique among existing views

## Effects

### Immediate
- New view entity is created with the specified sources
- View context switches to the newly created view

### Asynchronous
- View list refreshes to include the new view
- Initial preview query executes against the sources

## Error Cases

| Condition | Error |
|-----------|-------|
| `name` already exists | Duplicate view name |
| Source ref not found | Invalid source reference |
| Empty `sourceRefs` array | At least one source required |

## Idempotency

Not idempotent. Each call creates a new view, even with the same name (which would fail on duplicate).

## Related Tools

- [addColumn](./add-column.md) — Add columns after creating the view
- [addJoin](./add-join.md) — Join sources after creating the view
- [deleteView](./delete-view.md) — Delete a view
- [renameView](./rename-view.md) — Rename a view

## Related Entities

- [Dataset](../entities/dataset.md)
