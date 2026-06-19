# Slice 08 — Contract: drop embedded-JSON columns `@infrastructure`

**Goal:** Remove the now-unread JSON columns after one safe release, leaving one source of truth.

> `@infrastructure` — no user-visible output. The **contract** half of expand/contract.
> Cannot release on its own; gated behind one production release in which slices 03–07
> have run read-from-rows successfully.

**IN scope**
- Migration dropping `views.{columns,joins,filters,grain}` and `reports.columns_metadata`.
- Remove the write-both bridge code.
- Rollback path: re-add columns + re-backfill from rows.

**OUT of scope**
- Any new behavior or table.
- Normalizing `source_refs` (OQ-1 follow-on, stays JSON).

**Learning hypothesis**
- Disproves "nothing still reads the JSON" if any relation's char snapshot drifts after the drop.

**Acceptance criteria**
- After one release of read-from-rows for slices 03–07, JSON columns dropped.
- Char snapshot byte-identical after the drop. *(AC2)*
- Rollback path exercised in a test. *(decision 5)*

**Dependencies:** blocked by 03, 04, 05, 06, 07 + one-release gate. **Blocks:** —.
**Effort:** ~0.5 day. **Reference class:** standard expand/contract column drop.
**SPIKE:** none.

Traces: AC2 · ADR-052 decision 5.
