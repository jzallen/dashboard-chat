# undoCleaningTransform

## Summary

Undo a cleaning transform by disabling or deleting it.

## Context

**Available in:** Dataset
**Condition:** Dataset selected, schema available

## Parameters

```json
{
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "enum": ["disable", "delete"],
      "description": "disable (reversible) or delete (permanent)"
    },
    "transformId": {
      "type": "string",
      "description": "Target transform ID. If omitted, targets the most recent transform."
    }
  },
  "required": ["action"]
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | enum | Yes | `disable` (reversible) or `delete` (permanent) |
| `transformId` | string | No | Target transform ID, or most recent if omitted |

## Preconditions

- Active dataset context with schema available
- At least one transform exists in the dataset's transform stack
- If `transformId` is provided, it must reference an existing transform

## Effects

### Immediate
- `disable`: Transform is marked as disabled but retained in the stack
- `delete`: Transform is permanently removed from the stack

### Asynchronous
- Table data refreshes without the disabled/deleted transform applied
- Transform history updates to reflect the new state

## Error Cases

| Condition | Error |
|-----------|-------|
| No transforms exist | No transform to undo |
| `transformId` not found | Invalid transform reference |
| Transform already disabled (for `disable` action) | No-op or already disabled |

## Idempotency

`disable` is idempotent — disabling an already-disabled transform is a no-op. `delete` is not idempotent — the second call fails with not-found.

## Related Tools

- [applyCleaningTransform](./apply-cleaning-transform.md) — Apply a transform (reverse of undo)
- [reEnableCleaningTransform](./re-enable-cleaning-transform.md) — Re-enable a disabled transform

## Related Entities

- [Dataset](../entities/dataset.md)
- [Transform](../entities/transform.md)
