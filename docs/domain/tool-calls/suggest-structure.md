# suggestStructure

## Summary

Analyze the report's source columns and suggest dimensions, measures, and entities based on naming conventions and data types. Returns suggestions for the user to review — does not modify the report.

## Context

**Available in:** Report
**Condition:** Report selected

## Parameters

```json
{
  "type": "object",
  "properties": {
    "sourceColumns": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "type": { "type": "string" }
        },
        "required": ["name", "type"]
      }
    }
  },
  "required": ["sourceColumns"]
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sourceColumns` | array | Yes | Source columns to analyze — each `{ name, type }` |

## Preconditions

- Report is selected and active

## Heuristics

| Pattern | Suggestion |
|---------|------------|
| Column name ends with `_id` | entity (foreign key) |
| Column name ends with `_at`, `_date`, `_timestamp` or type is date/time | dimension (time) |
| Type is numeric (int, float, decimal, numeric, double, bigint) | measure (sum) |
| Otherwise | dimension (categorical) |

## Effects

### Immediate
- None — returns a formatted suggestion string to the chat

### Asynchronous
- None — no API call, no cache invalidation

## Error Cases

None. Unrecognized types fall through to `dimension (categorical)`.

## Idempotency

Idempotent. Pure function of the input columns.

## Related Tools

- [addDimension](./add-dimension.md) — Apply a suggested dimension
- [addMeasure](./add-measure.md) — Apply a suggested measure
- [createReport](./create-report.md) — Create the report first

## Related Entities

- [Report](../entities/report.md)
