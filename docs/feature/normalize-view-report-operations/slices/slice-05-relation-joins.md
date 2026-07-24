# Slice 05 — `relation_joins` normalized (sequence, order honored)

**Goal:** Normalize joins with an explicit declaration-ordered `sequence`, preserving compiled SQL and making reorder deterministic.

**IN scope**
- `relation_joins`: `(parent_type, parent_id)`, `org_id`, `project_id`, join VO fields, `sequence: int NOT NULL` (per parent).
- Backfill: `sequence = ROW_NUMBER() OVER (PARTITION BY parent_id ORDER BY <array index>)` — array position, not `created_at`.
- Index `(parent_id, sequence)`.
- Write-both, read-rows; renderer chains joins in `sequence` order.

**OUT of scope**
- Dropping JSON `joins` column (slice 08).
- Partial-order/DAG joins (rejected in ADR-052).

**Learning hypothesis**
- Disproves "JSON array position == the declaration order the compiler honors" if array-position backfill changes rendered SQL (char snapshot drift).

**Acceptance criteria**
- Swapping two `relation_joins.sequence` → different SQL. *(AC3, P3)*
- Joins read in `sequence` order → same SQL as the equivalent embedded-array view built in the test. *(AC2, P2)*
- Backfill uses array position. *(decision 5)*
- `(parent_id, sequence)` indexed; indexed `org_id`. *(AC7)*

**Dependencies:** blocked by 03. **Blocks:** —. **Effort:** ~1 day.
**Reference class:** slice 03 pattern + correctness-bearing order (`sql_generator.py:237-241`).
**SPIKE:** none.

Traces: AC2, AC3, AC7, P2, P3 · ADR-052 decisions 2, 5.
