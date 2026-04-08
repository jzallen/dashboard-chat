# deleteRow

## Summary

Delete a row by searching for matching text across all columns.

## Context

**Available in:** Dataset
**Condition:** Dataset selected, schema available

## Parameters

```json
{
  "type": "object",
  "properties": {
    "search": {
      "type": "string",
      "description": "Text to match against any column value"
    }
  },
  "required": ["search"]
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `search` | string | Yes | Text to match against any column value |

## Preconditions

- Active dataset context with schema available
- At least one row exists in the dataset

## Effects

### Immediate
- First row matching the search text is removed from the dataset

### Asynchronous
- Table preview refreshes without the deleted row
- Row count decrements

## Error Cases

| Condition | Error |
|-----------|-------|
| No row matches search text | No matching row found |
| Multiple rows match | First match is deleted (potential ambiguity) |

## Idempotency

Not idempotent in general. If multiple rows match, successive calls delete successive matches. If only one row matched, the second call returns no match.

## Related Tools

- [addRow](./add-row.md) — Add a row

## Related Entities

- [Dataset](../entities/dataset.md)
