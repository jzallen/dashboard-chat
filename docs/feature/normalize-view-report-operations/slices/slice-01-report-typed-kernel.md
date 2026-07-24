# Slice 01 — Report projection on the typed kernel

**Goal:** Lift Report's `columns_metadata` dict-soup onto Pydantic discriminated unions so a malformed column is rejected at the boundary, never at render time.

**IN scope**
- `ProjectionColumn`/`Measure` typed VOs as discriminated unions over `semantic_role` (mirroring `ViewFilterVariant` over `operator`).
- Report use cases hydrate/validate columns through the typed kernel.
- Retire `validate_columns_metadata` (`report/column_validation.py`).
- Storage stays JSON this slice (no table change yet).

**OUT of scope**
- Normalized `relation_columns` table (slice 04).
- View column changes (View is already typed).
- Renderer consolidation (slice 02).

**Learning hypothesis**
- Disproves "`columns_metadata` is as regular as `column_validation` assumed" if existing reports fail to load through the union — production shapes are irregular.

**Acceptance criteria**
- Unknown `semantic_role` → structured `422`/`Failure`, nothing persisted. *(AC4, P4)*
- Invalid role/type pair rejected by the union, not the free function. *(AC4)*
- Every existing report hydrates through the new types. *(production coverage)*
- `validate_columns_metadata` removed.

**Dependencies:** none. **Blocks:** 04, 07. **Effort:** ~1 day.
**Reference class:** `ViewFilterVariant` discriminated-union promotion (existing pattern).
**SPIKE:** none.

Traces: AC4, P4 · ADR-052 decision 3 · domain-model §2.5.
