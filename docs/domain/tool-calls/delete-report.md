# deleteReport

## Summary

Delete the current report.

## Context

**Available in:** Report
**Condition:** Report selected

## Parameters

No parameters (operates on the currently selected report from chat context).

## Preconditions

- Report is selected and active

## Effects

### Immediate
- `DELETE /api/reports/{id}` deletes the report
- Chat context is cleared (`setContext(null, null)`)
- Browser navigates away from the report page (to `/`)

### Asynchronous
- Report list cache is invalidated for the current project

## Error Cases

| Condition | Error |
|-----------|-------|
| Report not found | API 404 |
| Report is referenced by another entity | Depends on backend referential policy |

## Idempotency

Not idempotent in practice — a second call after the first succeeds will 404.

## Related Tools

- [createReport](./create-report.md) — Create a report
- [renameReport](./rename-report.md) — Rename instead of deleting

## Related Entities

- [Report](../entities/report.md)
