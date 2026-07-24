# Slice 03 — `relation_filters` normalized (pattern-prover)

**Goal:** Disaggregate the `filters` JSON array into the first normalized component table, establishing the shared component-table repository + polymorphic cascade pattern.

**IN scope**
- `relation_filters` table: `(parent_type, parent_id)`, `org_id`, `project_id`, filter VO columns; commutative (no order column).
- Expand/contract migration: backfill explodes each JSON `filters` element to one row.
- Shared component-table repository abstraction + repo-enforced polymorphic cascade + `parent_type` CHECK.
- Write-both (JSON + rows), read-rows; renderer's filter step reads rows.
- Composite `(org_id, parent_type, parent_id)` index.

**OUT of scope**
- Other component tables (04–07).
- Dropping the JSON `filters` column (slice 08).

**Learning hypothesis**
- Disproves "the expand/contract + polymorphic `(parent_type,parent_id)` + repo-enforced cascade pattern holds" — if filters break it, the other four will too.

**Acceptance criteria**
- Adding one filter = single-row INSERT (no array rewrite). *(AC6)*
- Backfill: every JSON filter → one keyed row; renderer reads rows. *(decision 5)*
- Reordering filters → SQL unchanged. *(AC3 negative)*
- Parent delete removes exactly its filter rows. *(P5, AC7)*
- Indexed `org_id`; `org_id`-scoped loads. *(AC7)*
- JSON column retained this release.

**Dependencies:** blocked by 00, 02. **Blocks:** 04, 05, 06, 07.
**Effort:** ~1 day. **Reference class:** `transform_record` per-row provenance pattern + `alembic-migration` skill.
**SPIKE:** OQ-4 polymorphic-cascade enforcement (repo path + CHECK vs trigger) — resolve here.

Traces: AC6, AC7, P5 · ADR-052 decisions 1, 5.
