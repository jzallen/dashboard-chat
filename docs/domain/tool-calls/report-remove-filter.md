# removeFilter (Report)

## Summary

Remove a filter condition from the report's `sql_definition` by stripping any WHERE-clause fragment mentioning the specified column.

> This is the **report-context** `removeFilter`. For the view-context equivalent, see [removeFilter (View)](./remove-filter.md). The report version uses regex-based SQL rewriting, the view version mutates structured filter metadata.

## Context

**Available in:** Report
**Condition:** Report selected

## Parameters

```json
{
  "type": "object",
  "properties": {
    "column": { "type": "string", "description": "Column whose filter should be removed" }
  },
  "required": ["column"]
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `column` | string | Yes | Column whose filter condition should be removed |

## Preconditions

- Report is selected and active

## Effects

### Immediate
- Reads current `sql_definition` from cache
- Strips any clause matching `(AND)? <column> <op> ('<value>')?` from the SQL (case-insensitive)
- `PATCH /api/reports/{id}` with the rewritten `sql_definition`

### Asynchronous
- Report detail cache is invalidated

## Error Cases

| Condition | Error |
|-----------|-------|
| Report not found | API 404 |
| Column appears in non-WHERE positions (SELECT, GROUP BY) | Only WHERE-clause fragments are stripped; other occurrences are left alone |
| Resulting SQL has dangling `WHERE` keyword | API error from backend SQL validator |

## Idempotency

Idempotent. Removing a filter that does not exist is a no-op.

## Related Tools

- [addFilter (Report)](./report-add-filter.md) — Add a filter to the report SQL
- [removeFilter (View)](./remove-filter.md) — View-context equivalent

## Related Entities

- [Report](../entities/report.md)
