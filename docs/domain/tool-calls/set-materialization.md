# setMaterialization

## Summary

Set the view's materialization strategy.

## Context

**Available in:** View
**Condition:** View selected

## Parameters

```json
{
  "type": "object",
  "properties": {
    "strategy": {
      "type": "string",
      "enum": ["view", "table", "ephemeral", "incremental"],
      "description": "Materialization strategy"
    }
  },
  "required": ["strategy"]
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `strategy` | enum | Yes | `view`, `table`, `ephemeral`, or `incremental` |

## Preconditions

- View is selected and active

## Effects

### Immediate
- View's materialization strategy is updated

### Asynchronous
- View metadata refreshes to reflect the new strategy
- Generated dbt model config updates accordingly

## Error Cases

| Condition | Error |
|-----------|-------|
| Invalid strategy value | Validation error |
| `incremental` without a time column configured | May require `setGrain` first |

## Idempotency

Idempotent. Setting the same strategy twice produces the same state.

## Related Tools

- [setGrain](./set-grain.md) — Configure time dimension (often needed with `incremental`)
- [createView](./create-view.md) — Create view first

## Related Entities

- [Dataset](../entities/dataset.md)
