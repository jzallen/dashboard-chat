# resolve_dataset

## Summary

Resolve a dataset by name when the user references one in conversation without an active context.

## Context

**Available in:** Conversational
**Condition:** No dataset or view is active

## Parameters

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "Dataset name the user is referring to"
    }
  },
  "required": ["name"]
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Dataset name the user is referring to |

## Preconditions

- No dataset or view context is active
- User has referenced a dataset by name in conversation

## Effects

### Immediate
- Tool call emitted in the SSE stream

### Asynchronous
- The frontend intercepts this tool call via SSE stream transformation, searches for a matching dataset, and resubmits the request with the resolved schema
- If a match is found, the chat context transitions to Dataset mode with the resolved schema

## Error Cases

| Condition | Error |
|-----------|-------|
| No dataset matches the provided name | Frontend displays resolution failure; user prompted to clarify |
| Multiple datasets match ambiguously | Frontend may prompt user to disambiguate |

## Idempotency

Safe to call multiple times. Each call triggers a fresh dataset lookup on the frontend.

## Related Tools

- [filterTable](./filter-table.md) — Available after dataset is resolved
- [sortTable](./sort-table.md) — Available after dataset is resolved

## Related Entities

- [Dataset](../entities/dataset.md)
