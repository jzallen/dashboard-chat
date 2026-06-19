# Slice 00 — Render-SQL characterization snapshot (walking skeleton)

**Goal:** Pin the SQL every existing view and report compiles to today, so no later slice changes rendered output by accident.

**IN scope**
- A characterization pytest suite rendering each seeded view/report via `ibis.to_sql(dialect="duckdb")`.
- Golden snapshot artifact per relation; deterministic (stable ordering, no timestamps).
- A way to dump one relation's SQL for inspection.

**OUT of scope**
- Any change to the renderer, schema, or models.
- New tables or migrations.

**Learning hypothesis**
- Disproves "render is a pure function of persisted state" if two equivalent relations snapshot differently (hidden render state).

**Acceptance criteria**
- Suite emits + pins compiled SQL for every seeded view and report. *(AC2 baseline)*
- A deliberate SQL change fails the suite with a per-relation diff. *(AC2)*
- Re-run with no change is deterministic. *(AC1)*
- Captured from real seeded/dev relations.

**Dependencies:** none. **Blocks:** slice 02 (hard gate), reused by 03–08.
**Effort:** ~0.5 day. **Reference class:** characterization-test harness over an existing compiler.
**SPIKE:** none.

Traces: AC1, AC2, P2 · ADR-052 "render equivalence" + brownfield walking-skeleton rule.
