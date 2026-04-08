# reEnableCleaningTransform

## Summary

Re-enable a previously disabled transform.

## Context

**Available in:** Dataset
**Condition:** Dataset selected, schema available

## Parameters

```json
{
  "type": "object",
  "properties": {
    "transformId": {
      "type": "string",
      "description": "Target transform ID. If omitted, targets the most recently disabled transform."
    }
  },
  "required": []
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `transformId` | string | No | Target transform ID, or most recently disabled if omitted |

## Preconditions

- Active dataset context with schema available
- At least one disabled transform exists in the dataset's transform stack
- If `transformId` is provided, it must reference a disabled transform

## Effects

### Immediate
- Transform is marked as enabled in the stack

### Asynchronous
- Table data refreshes with the re-enabled transform applied
- Transform history updates to reflect the active state

## Error Cases

| Condition | Error |
|-----------|-------|
| No disabled transforms exist | No transform to re-enable |
| `transformId` not found | Invalid transform reference |
| Transform is already enabled | No-op or already enabled |

## Idempotency

Idempotent. Re-enabling an already-enabled transform is a no-op.

## Related Tools

- [undoCleaningTransform](./undo-cleaning-transform.md) — Disable or delete a transform
- [applyCleaningTransform](./apply-cleaning-transform.md) — Apply a new transform

## Related Entities

- [Dataset](../entities/dataset.md)
- [Transform](../entities/transform.md)
