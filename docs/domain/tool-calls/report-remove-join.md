# removeJoin (Report)

## Summary

Remove a join from the report by the right-side source ID. Strips both the `source_refs` entry and the matching JOIN clause from `sql_definition`.

> This is the **report-context** `removeJoin`. For the view-context equivalent, see [removeJoin (View)](./remove-join.md).

## Context

**Available in:** Report
**Condition:** Report selected

## Parameters

```json
{
  "type": "object",
  "properties": {
    "rightRefId": { "type": "string", "description": "ID of the right-side source to remove" }
  },
  "required": ["rightRefId"]
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `rightRefId` | string | Yes | ID of the right-side source whose join should be removed |

## Preconditions

- Report is selected and active

## Effects

### Immediate
- Reads current `source_refs` and `sql_definition` from cache
- Filters `source_refs` to remove entries where `id === args.rightRefId`
- Strips any `[INNER|LEFT|RIGHT|FULL] JOIN <rightRefId> ON <col> = <col>` clause from `sql_definition`
- `PATCH /api/reports/{id}` with both fields updated

### Asynchronous
- Report detail cache is invalidated

## Error Cases

| Condition | Error |
|-----------|-------|
| Report not found | API 404 |
| No join matches `rightRefId` | Silent no-op |
| SQL contains complex join syntax the regex does not match | JOIN clause may remain — fall back to `renameReport` + manual SQL correction |

## Idempotency

Idempotent. Removing a join that does not exist is a no-op.

## Related Tools

- [addJoin (Report)](./report-add-join.md) — Add a join to the report
- [removeJoin (View)](./remove-join.md) — View-context equivalent

## Related Entities

- [Report](../entities/report.md)
