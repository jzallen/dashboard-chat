# Prioritization — Normalize View/Report Operations

**Wave:** DISCUSS · **Feature:** `normalize-view-report-operations` · **Linear:** DC-78

Ordering criteria: **(a) riskiest-assumption-first** — surface the shakiest design
bet as early and as cheaply as possible; **(b) Value × Urgency ÷ Effort** — rank by
outcome impact against cost; **(c) dependency chain** — no story before what it needs.

There is **no walking-skeleton story** and **no characterization/dogfood gate** in
this ordering (see `story-map.md` for the rationale). The safety mechanism is a RED
acceptance test per Scenario, authored before implementation; render-equivalence is a
self-contained in-test property over a fixture built inside the test, never a snapshot
of pre-existing relations.

## Recommended execution order

| Order | Story | Value × Urgency ÷ Effort | Why here (riskiest-assumption lens) | Blocked by |
|---|---|---|---|---|
| 1 | 01 — Report-typed kernel (DC-81) | High value, high urgency, low effort | Independent (no migration). Pays the `columns_metadata` dict-soup debt the renderer consumes; loading report shapes through the discriminated union is the cheapest place to prove the typed kernel holds. **Riskiest assumption:** `columns_metadata` is as regular as `column_validation` assumed. | — |
| 2 | 02 — Kernel visitor + report extension (DC-82) | High value, high urgency, medium effort | Consolidate the renderer once, on 01's typed columns, before persistence churns under it. **Riskiest assumption:** the two compilers' shared steps are truly identical — proven by the in-test pre-vs-post render-equivalence property, not a legacy snapshot. | 01 |
| 3 | 03 — `relation_filters` (DC-83, pattern-prover) | High value, high urgency, medium effort | **Riskiest-assumption pattern-prover.** Establishes the shared component-table repo + expand/contract + polymorphic `(parent_type, parent_id)` cascade on the simplest (commutative, order-free) component. If the shared-table bet is wrong, learn it here at lowest cost before four replications ride on it. | 02 |
| 4 | 05 — `relation_joins` (DC-85) | High value, high urgency, medium effort | Next-highest uncertainty: array-position == declaration-order is an unverified backfill assumption with **correctness impact** (AC3/P3). Not a mere replication — it adds the correctness-bearing `sequence` and its own order-honored probe. | 03 |
| 5 | 04 — `relation_columns` (DC-84) | High value, medium urgency, low effort | Lower risk once 03 proved the pattern; proves the shared cross-role projection (view + report columns in one `ProjectionColumn` row). Needed before 07 (measures are columns). | 01, 03 |
| 6 | 06 — `relation_grain` (DC-86) | Medium value, medium urgency, low effort | Low risk after 03; small; resolves OQ-3 cardinality (one row per parent vs per key). Needed before 07 (measure-requires-grain). | 03 |
| 7 | 07 — `relation_aggregations` + report rules (DC-87) | High value, medium urgency, medium effort | Last component; depends on shared columns (04) and grain (06); carries the report-only invariants (measure-requires-dimension, no mart-to-mart) over typed rows. Resolves OQ-2 at DISTILL. | 04, 06 |
| 8 | 08 — drop JSON (DC-88, contract) | Medium value, low urgency, low effort | `@infrastructure` cleanup; gated behind one production release of 03–07 reading from rows. Rollback path required. | 03, 04, 05, 06, 07 |

## Replication note (honest scoping)

Stories **04** and **06** are the **lowest-risk replications** of the Story-03
pattern — their learning is the specific delta (cross-role projection in 04; grain
cardinality in 06), **not** the expand/contract + polymorphic-cascade mechanics,
which Story 03 already proved. They are kept as separate stories for clean review
boundaries and independent rollback, **not** because each carries fresh pattern risk.

Story **05** is *not* a mere replication — it adds the correctness-bearing `sequence`
column and its own array-position-honored probe, which is why it is sequenced
immediately after the pattern-prover rather than among the low-risk replications.
