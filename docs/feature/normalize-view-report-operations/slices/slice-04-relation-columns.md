# Slice 04 — `relation_columns` normalized (shared projection)

**Goal:** Move both view and report projected columns into one shared `relation_columns` table, proving the shared-kernel projection across roles.

**IN scope**
- `relation_columns`: `(parent_type, parent_id)`, `org_id`, `project_id`, `ProjectionColumn` fields, `ColumnRole` (entity/dimension/time/measure), `position: int NULL` (presentation only).
- Backfill view `columns` + report column rows (from slice 01's typed VOs).
- Write-both, read-rows; renderer projects from rows.

**OUT of scope**
- Dropping JSON columns (slice 08).
- Aggregation binding (slice 07).

**Learning hypothesis**
- Disproves "view columns and report entity/dimension/measure columns fit one `ProjectionColumn` row" — if not, Option B's shared projection is wrong.

**Acceptance criteria**
- Both roles write `ProjectionColumn` rows to `relation_columns`. *(decision 1)*
- `SELECT … WHERE output_name='X'` returns both views and reports. *(cross-role query)*
- Reordering columns / changing `position` → SQL unchanged. *(AC3 negative)*
- Added column = single-row INSERT. *(AC6)*
- Char snapshot byte-identical; tenant scoping + cascade per slice 03. *(AC2, AC7, P5)*

**Dependencies:** blocked by 01, 03. **Blocks:** 07. **Effort:** ~1 day.
**Reference class:** slice 03 pattern (lower risk replication, + cross-role + `position`).
**SPIKE:** none.

Traces: AC2, AC6, AC7 · ADR-052 decisions 1, 3.
