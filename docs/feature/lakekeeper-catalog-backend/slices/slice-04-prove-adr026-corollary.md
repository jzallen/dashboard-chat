# Slice 04 — Prove the ADR-026 materialization corollary

**Story:** US-4 · **Sub-job:** SJ-4 · **Plane:** Compile invariant (ADR-026) · **Effort:** ~1 day · **This is the load-bearing slice.**

## Goal (one sentence)
Prove the materialized Iceberg table is a **derived cache** — that re-deriving from the persisted operations reproduces it, and that compilation passes with **LakeKeeper offline** — so that materialization is demonstrably not a render-time authority and the ADR-026 determinism invariant is intact.

## IN scope
- The **ADR-026 determinism probe** (born here): (a) re-derive the table by recompiling the persisted operations and re-running the write, assert equivalence with the materialized table; (b) run compilation with LakeKeeper **offline** and assert `compile(ops) == compile(load_and_recompile(ops))` (`adr-051...:283-289`).
- A guard that **no compile/render path** resolves a column, type, or partition by querying LakeKeeper.
- Confirm any exported Iceberg **View** is treated as an export **sink**, never a source read back.

## OUT scope
- Reading the table back for handoff (Slice 05 — though the probe's re-derive read is not a handoff read).
- Broadening the probe to many datasets (one dataset proves the invariant for the skeleton).

## Learning hypothesis
**Disproves** that the materialized table is a **derived cache**: that re-deriving from operations reproduces it AND that compilation passes with **LakeKeeper offline**. If the probe cannot pass with the catalog disconnected, the integration **violates ADR-026** (`[K1]`) and must be reworked before anything ships — this is the gate the whole scoped BUY rests on.
**Confirms** (if it succeeds) that materialization is a safe derived cache and the ADR-026 anxiety (the dominant restraining force, `jtbd-job-stories.md` four-forces) is discharged by proof, not assertion.

## Acceptance criteria
- AC1: Re-deriving the table from the persisted operations (recompile via Ibis + re-run the write) produces a table **equivalent** to the materialized one (production dataset, real operations).
- AC2: With **LakeKeeper offline**, compiling the operations succeeds without contacting the catalog, and `compile(ops) == compile(load_and_recompile(ops))` — the determinism probe **PASSES with the catalog disconnected**.
- AC3: No compile/render path resolves any column, type, or partition from the live catalog; any exported Iceberg View is a sink only (asserted against the compile path + export path).

## Dependencies
BlockedBy Slice 03 (needs a materialized table to prove is a cache). Its probe is re-asserted by Slice 05. This slice + Slice 03 are the walking-skeleton rib — the probe exists the moment the table does.

## Dogfood moment
Switch off LakeKeeper and watch compilation still succeed and the probe pass; re-derive the table and watch it match — proof, on your own dataset, that materializing changed nothing about what a transform *is*.

## Reference class
The ADR-051-style reproducibility probe (`compile(ops) == compile(load_and_recompile(ops))`) already exists as the pattern for the determinism invariant; this slice extends it to assert the invariant holds **with the external catalog disconnected** and that the materialized table equals the re-derived one. The corollary is stated in `../discover/buy-vs-build.md` Q-dbt "ADR-026 boundary".
