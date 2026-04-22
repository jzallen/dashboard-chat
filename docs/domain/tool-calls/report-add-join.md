# addJoin (Report)

## Summary

Add a join to the report. Extends both `source_refs` and `sql_definition` in a single PATCH.

> This is the **report-context** `addJoin`. For the view-context equivalent, see [addJoin (View)](./add-join.md). Sources must be datasets or views — **never other reports**.

## Context

**Available in:** Report
**Condition:** Report selected

## Parameters

```json
{
  "type": "object",
  "properties": {
    "rightRef": {
      "type": "object",
      "properties": {
        "id": { "type": "string", "description": "Source dataset or view ID" },
        "type": { "type": "string", "enum": ["dataset", "view"] }
      },
      "required": ["id", "type"]
    },
    "leftColumn": { "type": "string", "description": "Column on the left side of the join" },
    "rightColumn": { "type": "string", "description": "Column on the right side of the join" },
    "joinType": { "type": "string", "enum": ["INNER", "LEFT", "RIGHT", "FULL"] }
  },
  "required": ["rightRef", "leftColumn", "rightColumn"]
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `rightRef` | object | Yes | `{ id, type }` — `type` must be `dataset` or `view`, never `report` |
| `leftColumn` | string | Yes | Column on the left side of the join |
| `rightColumn` | string | Yes | Column on the right side of the join |
| `joinType` | enum | No | `INNER` (default), `LEFT`, `RIGHT`, or `FULL` |

## Preconditions

- Report is selected and active
- `rightRef.type` must be `dataset` or `view` — the mart layer forbids mart-to-mart references
- `rightRef.id` must resolve to an existing dataset or view

## Effects

### Immediate
- Reads current `source_refs` and `sql_definition` from cache
- Appends `rightRef` to `source_refs` if not already present
- Appends ` <joinType> JOIN <rightRef.id> ON <leftColumn> = <rightColumn>` to `sql_definition`
- `PATCH /api/reports/{id}` with both fields updated

### Asynchronous
- Report detail cache is invalidated

## Error Cases

| Condition | Error |
|-----------|-------|
| `rightRef.type` is `report` | Schema validation error — reports cannot reference other reports |
| `rightRef.id` does not exist | API error from backend |
| Invalid SQL produced | API error from backend SQL validator |

## Idempotency

Not idempotent for SQL. `source_refs` is deduplicated (only added if not already present), but the JOIN clause is always appended — calling twice produces a doubled join.

## Related Tools

- [removeJoin (Report)](./report-remove-join.md) — Remove a join from the report
- [addJoin (View)](./add-join.md) — View-context equivalent

## Related Entities

- [Report](../entities/report.md)
