# Slice 06 — `relation_grain` normalized

**Goal:** Store a relation's grain (time column + dimension keys) as queryable rows, feeding the report aggregation step from one place.

**IN scope**
- `relation_grain`: `(parent_type, parent_id)`, `org_id`, `project_id`, grain key fields; set-like (no order column).
- Backfill from `views.grain` JSON.
- Write-both, read-rows; renderer/report extension reads grain from rows.
- Resolve OQ-3 cardinality (one row per parent vs per key).

**OUT of scope**
- Dropping JSON `grain` column (slice 08).
- Aggregation binding (slice 07).

**Learning hypothesis**
- Disproves "grain is one-row-per-parent (≅ `ViewGrain` 1:1)" if a relation needs multiple grain rows — OQ-3 cardinality assumption breaks.

**Acceptance criteria**
- Backfill produces grain rows (confirm cardinality at DISTILL). *(OQ-3)*
- Reordering grain keys → SQL unchanged. *(AC3 negative)*
- Char snapshot byte-identical after read swaps to rows. *(AC2)*
- Tenant scoping + cascade per slice 03. *(AC7, P5)*

**Dependencies:** blocked by 03. **Blocks:** 07. **Effort:** ~0.5 day.
**Reference class:** slice 03 pattern (lowest-risk replication).
**SPIKE:** none.

Traces: AC2, AC7 · ADR-052 decision 1 · resolves OQ-3.
