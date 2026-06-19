# Prioritization — Normalize View/Report Operations

**Wave:** DISCUSS · **Feature:** `normalize-view-report-operations` · **Linear:** DC-78

Ordering criteria (carpaccio): **(a) learning leverage** — highest-uncertainty
slices first so a wrong bet costs least; **(b) dependency chain**; **(c) dogfood
cadence** — each slice is exercised against real seeded relations the same day.

## Recommended execution order

| Order | Slice | Why here | Blocked by | Risk / learning |
|---|---|---|---|---|
| 1 | 00 — characterization snapshot | Hard gate: the safety net every later slice leans on. No renderer change is safe without it. | — | Low risk, high leverage — surfaces hidden render state before any edit. |
| 2 | 01 — Report typed kernel | Independent (no migration); pays the dict-soup debt the renderer consumes; loading all real reports through the union is the cheapest place to discover irregular production shapes. | — | **High learning** — proves `columns_metadata` regularity. Cheap to do, expensive to discover late. |
| 3 | 02 — kernel visitor merge | Consolidate the renderer once, behind the 00 net and on 01's typed columns, before persistence churns under it. | 00, 01 | Medium — behavioral-drift risk, fully covered by 00. |
| 4 | 03 — `relation_filters` (pattern-prover) | **Highest-leverage table slice.** Establishes the shared component-table repo + expand/contract + polymorphic cascade. If the pattern is wrong, learn it here on the simplest (commutative) component. | 00, 02 | **Highest learning** — the whole shared-table bet rides on this. |
| 5 | 05 — `relation_joins` | Next-highest uncertainty: array-position == declaration-order is an unverified backfill assumption with correctness impact. | 03 | High — join order is correctness-bearing (AC3/P3). |
| 6 | 04 — `relation_columns` | Lower risk after 03's pattern; proves shared projection across roles. Needed before 07 (measures are columns). | 01, 03 | Medium — shared-projection claim. |
| 7 | 06 — `relation_grain` | Low risk after 03; small; resolves OQ-3 cardinality. Needed before 07 (measure-requires-grain). | 03 | Low — replication of the pattern; cardinality check. |
| 8 | 07 — `relation_aggregations` + report rules | Last component; depends on shared columns (04) and grain (06); carries the report-only invariants. | 04, 06 | Medium — report rules over typed rows; resolves OQ-2. |
| 9 | 08 — drop JSON (contract) | `@infrastructure`; gated behind one production release of 03–07. | 03, 04, 05, 06, 07 | Low — pure cleanup; rollback path required. |

## Replication note (carpaccio honesty)

Slices **04** and **06** are the lowest-risk replications of the slice-03 pattern —
their learning is the specific delta (cross-role projection; grain cardinality), not
the expand/contract mechanics, which 03 already proved. They are kept as separate
issues for clean review boundaries and independent rollback, **not** because each
carries fresh pattern risk. Slice **05** is *not* a mere replication — it adds the
correctness-bearing `sequence` and its own order-honored probe.

## Dogfood cadence

Each slice's AC runs against existing seeded/dev views and reports the same day it
lands (the characterization suite from slice 00 re-runs on every later slice). No
slice is "done" on synthetic data alone.
