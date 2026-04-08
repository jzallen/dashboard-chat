# addRow

## Summary

Add a new row to the table.

## Context

**Available in:** Dataset
**Condition:** Dataset selected, schema available

## Parameters

```json
{
  "type": "object",
  "properties": {
    "data": {
      "type": "object",
      "description": "Key-value pairs matching column IDs to their values",
      "additionalProperties": true
    }
  },
  "required": ["data"]
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `data` | object | Yes | Key-value pairs matching column IDs |

## Preconditions

- Active dataset context with schema available
- Keys in `data` should correspond to valid column IDs in the active schema

## Effects

### Immediate
- New row appended to the dataset

### Asynchronous
- Table preview refreshes to include the new row
- Row count increments

## Error Cases

| Condition | Error |
|-----------|-------|
| Unknown column ID in data keys | Invalid column reference |
| Value type mismatch for column | Type validation error |
| Required column missing from data | Missing required field |

## Idempotency

Not idempotent. Each call adds a new row, even with identical data.

## Related Tools

- [deleteRow](./delete-row.md) — Remove a row

## Related Entities

- [Dataset](../entities/dataset.md)
