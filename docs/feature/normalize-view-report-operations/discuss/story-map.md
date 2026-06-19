# Story Map — Normalize View/Report Operations into a Shared Relation IR

**Wave:** DISCUSS · **Feature:** `normalize-view-report-operations` · **Linear:** DC-78
**Feature type:** Backend (refactor) · **JTBD analysis:** skipped — internal refactor,
the consuming "users" are the agent write-path, the M/Power-Query parser, and the
SQL renderer; their job is already validated by ADR-052 and DC-77.
**Builds on:** DESIGN wave (ADR-052, `domain-model.md`, `c4-component.md`,
`evaluation.md`, `wave-decisions.md`). Decisions are not re-litigated here; this map
slices them into shippable increments.

---

## The job (one sentence)

> When I evolve a view or report through chat, the parser, or the UI, I want each
> column / filter / join / grain / aggregation to be a first-class, queryable,
> individually-addressable row — so the IR maps cleanly onto inbound forms (M,
> agent tools) and outbound forms (ibis → SQL), and Report stops being dict-soup.

This is the prerequisite for reconciling the M → IR → ibis flow at the View/Report
tiers (the DC-77 follow-on).

---

## Backbone (user activities, left → right)

| A. See today's SQL | B. Make Report type-safe | C. Render from one kernel | D. Normalize each component | E. Retire the JSON |
|---|---|---|---|---|
| Pin the SQL each relation compiles to today | Lift Report's `columns_metadata` dict-soup onto the typed kernel | Collapse two compilers into kernel-visitor + report-extension | Disaggregate each JSON array into a `relation_*` table, expand/contract | Drop the embedded-JSON columns after one safe release |

The backbone is ordered by **safety dependency**, not by table: establish the
characterization net (A) → pay the typing debt that the renderer consumes (B) →
consolidate the renderer behind that net (C) → swap persistence one component at a
time under the consolidated renderer (D) → contract (E).

---

## Walking skeleton (brownfield equivalent)

Slice 00 — the **render-equivalence characterization harness**. ADR-052 + the
DESIGN handoff make this a hard gate: *the render-equivalence characterization
test MUST exist before the renderer merge.* It is the brownfield walking skeleton —
the safety net every later slice leans on. It ships observable value on its own
(an engineer can dump and inspect the exact SQL any relation compiles to today).

---

## Slices (elephant carpaccio — each ships end-to-end, ≤1 day)

| # | Slice | Activity | Ships (observable) | Learning hypothesis (disproves X if it fails) |
|---|---|---|---|---|
| 00 | Render-SQL characterization snapshot | A | `pytest` golden snapshot of every view/report's compiled SQL; inspectable per relation | **Render is a pure function of persisted state.** If two "equivalent" relations snapshot differently, the renderer carries hidden state. |
| 01 | Report projection on the typed kernel | B | `POST /api/projects/{id}/reports` with unknown `semantic_role` → structured 422, not a render-time crash | **`columns_metadata` is as regular as `column_validation` assumed.** If real reports fail to load through the discriminated union, production shapes are irregular. |
| 02 | Kernel visitor + report extension | C | Char snapshot byte-identical; an unhandled component discriminator fails the build | **The two compilers' shared steps are truly identical.** If the snapshot drifts on merge, the "duplication" was divergence. |
| 03 | `relation_filters` normalized | D | `SELECT * FROM relation_filters WHERE column='X'` returns rows; `addFilter` is a single-row INSERT | **The expand/contract + polymorphic `(parent_type,parent_id)` + repo-enforced cascade pattern holds.** If it doesn't hold for filters, it won't for the other four. |
| 04 | `relation_columns` normalized | D | One `SELECT` lists every view *and* report projecting column X | **View columns and Report (entity/dimension/measure) columns fit one `ProjectionColumn` row.** If not, Option B's shared projection is wrong. |
| 05 | `relation_joins` normalized | D | Swapping two joins' `sequence` changes the SQL; reordering filters does not | **JSON array position == declaration order the compiler honors.** If array-position backfill changes the rendered SQL, the assumed order was wrong. |
| 06 | `relation_grain` normalized | D | Grain keys are queryable rows; char snapshot unchanged | **Grain is one-row-per-parent (≅ `ViewGrain` 1:1).** If a relation needs multiple grain rows, OQ-3's cardinality assumption breaks. |
| 07 | `relation_aggregations` normalized (report-only) + report rules on rows | D | Report with a measure but no dimension → structured rejection; report sourcing a report → rejected | **Report rules are expressible over typed rows without dict-probing.** If they still need raw-dict access, the kernel promotion is incomplete. |
| 08 | Contract: drop embedded-JSON columns | E | Migration removes `views.{columns,joins,filters,grain}` + `reports.columns_metadata`; all reads already off JSON | *(@infrastructure — contract half; rides the release after 03–07 confirmed in production)* |

---

## Carpaccio taste tests

| Test | Verdict |
|---|---|
| Any slice ships 4+ new components? | **PASS** — each table slice ships exactly one `relation_*` table + its write/read path. |
| Every slice depends on a new abstraction shipped later? | **PASS** — the shared component-table repository abstraction ships *first* and standalone in slice 03 (the pattern-prover); 04–07 reuse it. |
| Does any slice disprove a pre-commitment? | **PASS** — 00 (render purity), 02 (compiler equivalence), 03 (shared-table pattern), 04 (shared projection), 05 (array-order==declaration-order) each disprove a named design bet. |
| Slices using only synthetic data? | **PASS** — every slice's AC runs against existing seeded/dev views and reports (production-shaped data), not fabricated rows. The char snapshot (00) is captured from real relations. |
| 2+ slices identical except scale? | **NOTED, not merged.** 03–07 share a *pattern* but differ materially: filters are commutative (no order), columns carry `position` + are cross-role, joins carry correctness-bearing `sequence`, grain tests cardinality, aggregations are report-only + carry the report invariants. Slice 03 carries the pattern-proving learning; 04/06 are the lowest-risk replications (flagged in `prioritization.md`). |
| Any slice with no user-visible output? | Slice 08 only (`@infrastructure`). It is the contract half of expand/contract, not a value slice — it cannot release on its own and is gated behind one production release of 03–07. |

---

## Out of scope (feature non-goals, from ADR-052)

- Folding View/Report into the Dataset-staging `transforms` table (ADR-051 Finding 2 stands).
- Normalizing `source_refs` into a `relation_sources` table (OQ-1 — separable follow-on).
- An outbound operations → M renderer (admitted by the dispatch catalog, deferred).
- Reintroducing stored executable translation logic (rules-as-data stays rejected, ADR-026).

---

## Open questions routed to DISTILL/DELIVER (carried from ADR-052)

- **OQ-2** `fact`/`dimension` `report_type` — structural or label? → DISTILL (slice 07).
- **OQ-3** `relation_grain` cardinality — one row per parent vs per key → DISTILL (slice 06).
- **OQ-4** polymorphic-cascade enforcement — repo path + CHECK vs trigger → DELIVER (slice 03 establishes, each slice inherits).
