# Slice 07 — `relation_aggregations` (report-only) + report rules on rows

**Goal:** Add the report-only aggregation table and enforce measure-requires-dimension and no-mart-to-mart over typed rows.

**IN scope**
- `relation_aggregations` (report parent only): `(parent_type, parent_id)`, `org_id`, `project_id`, measure→aggregation-function binding; independent (no order column).
- `ReportRequiresDimension` over typed rows (not dict probes).
- `InvalidReportReference` (no-mart-to-mart) promoted to a first-class method on the shared composition service, peer to View's circular-dependency arm.
- Write-both, read-rows; report extension reads aggregations from rows.
- Resolve OQ-2 (`report_type` structural vs label) at DISTILL.

**OUT of scope**
- Dropping JSON columns (slice 08).
- View aggregation (View has no aggregate-over-grain operator).

**Learning hypothesis**
- Disproves "report rules are expressible over typed rows without dict-probing" if the checks still need raw-dict access — kernel promotion incomplete.

**Acceptance criteria**
- Measure + no dimension → `ReportRequiresDimension` over typed rows. *(AC4)*
- Report sourcing a report → `InvalidReportReference` via composition service. *(AC4)*
- Valid measure → single `relation_aggregations` row. *(decision 1, AC6)*
- Reordering aggregations → SQL unchanged. *(AC3 negative)*
- Rendered SQL unchanged from the embedded-array render for the same in-test fixture; tenant scoping + cascade per slice 03. *(AC2, AC7, P5)*

**Dependencies:** blocked by 04, 06. **Blocks:** 08. **Effort:** ~1 day.
**Reference class:** slice 03 pattern + report invariants (`create_report.py:109-131`).
**SPIKE:** none.

Traces: AC2, AC4, AC6, AC7 · ADR-052 decisions 1, 3 · resolves OQ-2.
