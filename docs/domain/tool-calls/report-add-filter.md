# addFilter (Report)

## Summary

Add a filter condition to the report's `sql_definition` as an appended `WHERE` clause.

> This is the **report-context** `addFilter`. For the view-context equivalent, see [addFilter (View)](./add-filter.md). Tool names collide; the behavior differs — the report version mutates the raw SQL definition, the view version mutates structured filter metadata.

## Context

**Available in:** Report
**Condition:** Report selected

## Parameters

```json
{
  "type": "object",
  "properties": {
    "column": { "type": "string", "description": "Column to filter on" },
    "operator": {
      "type": "string",
      "enum": ["=", "!=", ">", ">=", "<", "<=", "IN", "NOT IN", "IS NULL", "IS NOT NULL", "LIKE", "NOT LIKE"]
    },
    "value": {
      "type": "string",
      "description": "Value to compare against (omit for IS NULL / IS NOT NULL)"
    }
  },
  "required": ["column", "operator"]
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `column` | string | Yes | Column to filter on |
| `operator` | enum | Yes | SQL comparison operator |
| `value` | string | No | Comparison value — omit for `IS NULL` / `IS NOT NULL` |

## Preconditions

- Report is selected and active
- `sql_definition` is present in cache

## Effects

### Immediate
- Reads current `sql_definition` from cache
- Appends ` AND <column> <operator> '<value>'` if a `WHERE` clause already exists, otherwise ` WHERE <column> <operator> '<value>'`
- `PATCH /api/reports/{id}` with the new `sql_definition`

### Asynchronous
- Report detail cache is invalidated

## Error Cases

| Condition | Error |
|-----------|-------|
| Report not found | API 404 |
| Invalid SQL produced (e.g. broken quoting on user-supplied value) | API error from backend SQL validator |

## Idempotency

Not idempotent. Calling twice appends the filter clause twice.

## Related Tools

- [removeFilter (Report)](./report-remove-filter.md) — Remove a filter from the report SQL
- [addFilter (View)](./add-filter.md) — View-context equivalent operating on structured filter metadata

## Related Entities

- [Report](../entities/report.md)
