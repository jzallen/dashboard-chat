<!-- DES-ENFORCEMENT : exempt -->
# Walking Skeleton — Render-equivalence characterization

**Feature:** normalize-view-report-operations
**Wave:** DISTILL
**Date:** 2026-07-24
**Author:** Quinn (nw-acceptance-designer)

> The `.feature` file is the SSOT for the skeleton's scenarios. This document is
> notes only — the chosen end-to-end path, why it is the brownfield walking
> skeleton, and the litmus checks it passes.

## What the skeleton is

Slice 00 (DC-80): the **render-SQL characterization snapshot**. It pins the exact
DuckDB SQL every existing view and report compiles to today, so that no later
slice changes rendered output by accident. It is the brownfield analog to a
walking skeleton — the safety net every later slice leans on — and it ships
observable value on its own: an engineer can dump and inspect the exact SQL any
relation compiles to.

SSOT: `tests/acceptance/normalize-view-report-operations/render-sql-characterization-snapshot.feature`
(3 scenarios; `@walking_skeleton @real-io @characterization @driving_port`).

## The chosen end-to-end path

1. **Seed real relations through the driving port.** The `Given` step seeds one
   representative view (`orders_view`, a decimal projection over a dataset
   source) and one representative report (`orders_report`, a dimension + measure
   aggregation) through `RepositoryContainer.metadata.create_view` /
   `create_report` against an in-memory aiosqlite engine. The Org/Project FK
   prerequisites are seeded directly on the test `db_session` (background setup,
   not the behavior under test). The relations are **real rows**, not fabricated
   fixtures.

2. **Render through the real compilers.** The `When` step drives the production
   characterization harness `app.use_cases.relation.render_characterization
   .render_all_relations`, which re-derives each relation's SQL from its
   persisted state through the real `ViewIbisCompiler.generate_executable` /
   `ReportIbisCompiler.generate_executable` → `ibis.to_sql(dialect="duckdb")`.

3. **Pin, diff, and re-run.** The three `Then` steps assert: (a) each relation
   pins a non-empty compiled SQL string; (b) a deliberate change to one
   relation's SQL fails the snapshot with a **per-relation diff** (proving the
   net is not a pass-through); (c) re-rendering with no change reproduces the
   identical snapshot (deterministic — stable ordering, no timestamps).

## Strategy: C-local (DWD-1)

Real SQLAlchemy + in-memory SQLite + real ibis→DuckDB rendering. No compose
stack. The two driven adapters that carry render-equivalence — the
SQLAlchemy/SQLite persistence adapter and the ibis renderer — are exercised for
real. This is the substrate the production compilers run against; the aiosqlite
engine mirrors `backend/tests/conftest.py`.

## Why it is the right walking skeleton (litmus)

- **Title describes a user goal?** YES — "Render-SQL characterization snapshot
  pins every relation's compiled SQL." The user is the engineer about to refactor
  the renderer; the goal is "it is safe to change the renderer/persistence."
- **Given/When describe user actions/context?** YES — "a fresh relation store
  seeded with a representative view and report"; "the characterization harness
  renders every seeded relation to SQL."
- **Then describe user observations?** YES — non-empty pinned SQL, a
  per-relation diff on drift, deterministic re-run. All on rendered-SQL outputs.
- **Demo-able to a stakeholder?** YES — "here is the exact SQL every relation
  compiles to today, and here is proof any accidental change is caught."
- **"If I deleted the real adapter, would it still pass?"** NO — without the real
  SQLite persistence AND the real ibis renderer, the harness cannot seed or
  render; the scenario errors at setup. It tests real wiring, not an InMemory
  double (Mandate 6).

## Hard gate

Slice 00 BLOCKS slice 02 (the kernel-visitor renderer consolidation) and is
re-run as the outer safety net by every renderer/persistence phase (02–08). The
brownfield walking-skeleton rule (ADR-052 Consequences) is made executable: the
characterization test MUST exist and be pinned before the renderer merge. If a
later phase drifts the snapshot, the change is wrong — never re-pin the snapshot
(Iron Rule).

## RED status at DISTILL

The skeleton is RED-**by-assertion**, not BROKEN. Running
`uv run --no-project pytest -m walking_skeleton` seeds the real relations and
constructs the real container successfully, then fails at the
`render_characterization` RED scaffold with `AssertionError: Not yet implemented
— RED scaffold`. DELIVER (Phase 00) implements the harness to turn it GREEN. The
render harness is intentionally a production module (not test-only glue) so the
outer loop drives a real production entry point — the SQL-render path is code the
refactor must keep working, not a test fixture.
