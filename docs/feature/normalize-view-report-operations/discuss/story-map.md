# Story Map — Normalize View/Report Operations into a Shared Relation IR

**Wave:** DISCUSS · **Feature:** `normalize-view-report-operations` · **Linear:** DC-78
**Feature type:** Backend (refactor) · **JTBD analysis:** skipped — internal refactor,
the consuming "users" are the agent write-path, the M/Power-Query parser, and the
SQL renderer; their job is already validated by ADR-052 and DC-77.
**Builds on:** DESIGN wave (ADR-052, `domain-model.md`, `c4-component.md`,
`evaluation.md`, `wave-decisions.md`). Decisions are not re-litigated here; this map
organizes them into a user-activity backbone and outcome-sliced releases.

---

## The job (one sentence)

> When I evolve a view or report through chat, the parser, or the UI, I want each
> column / filter / join / grain / aggregation to be a first-class, queryable,
> individually-addressable row — so the IR maps cleanly onto inbound forms (M,
> agent tools) and outbound forms (ibis → SQL), and Report stops being dict-soup.

This is the prerequisite for reconciling the M → IR → ibis flow at the View/Report
tiers (the DC-77 follow-on).

**Personas on this map:**

- **Modeler** — a data modeler who authors and evolves a View/Report by acting
  through the Agent (chat tools), the UI, or the API. Wants malformed shapes caught
  at the boundary and wants to query/target individual components.
- **Renderer engineer** — the engineer who maintains the View/Report → ibis → SQL
  renderer. Wants one kernel to edit and a build that fails loudly on an unhandled
  component.

---

## User Story Map

The map reads **left → right** across the **backbone** (the sequence of activities a
persona performs to author and evolve a relation), and **top → bottom** down the
**ribs** (the user stories that realize each activity). The horizontal **release
bands** cut the ribs into shippable outcomes.

### Backbone (user activities, left → right)

| A. Author a well-formed report | B. Trust one renderer | C. Refine components individually | D. Guard report semantics | E. Live on one source of truth |
|---|---|---|---|---|
| The modeler submits report columns and gets malformed shapes rejected at the boundary, on a typed kernel. | The renderer engineer maintains a single kernel visitor so a kernel change is one edit and gaps fail the build. | The modeler adds/queries filters, columns, joins, and grain as individually-addressable rows instead of rewriting JSON blobs. | The modeler gets fact-report rules (measure-needs-dimension, no mart-to-mart) enforced over typed rows at submit time. | The engineer runs the model on one schema after the embedded-JSON columns are retired. |

The backbone is ordered by the modeler's authoring flow, from *first make the shape
sound* (A) through *make the renderer trustworthy* (B), *let each component be
edited on its own* (C), *enforce the report-specific semantics* (D), to *collapse
onto a single source of truth* (E).

### Ribs (user stories under each activity)

```
BACKBONE →   A. Author a       B. Trust one     C. Refine components        D. Guard report   E. Live on one
             well-formed        renderer          individually                semantics         source of truth
             report

RIBS ↓       01 Report-typed   02 Kernel        03 relation_filters         07 relation_       08 Drop
             kernel               visitor +         (pattern-prover)            aggregations       embedded-JSON
             (reject malformed    report                                       + report rules     columns
             report column)       extension      04 relation_columns
                                                     (cross-role query)

                                                 05 relation_joins
                                                     (honor join order)

                                                 06 relation_grain
                                                     (queryable grain)
```

Each rib carries a short user-value phrase:

- **01 Report-typed kernel** *(→ DC-81)* — "reject a malformed report column at the
  moment I submit it, before it can reach the renderer."
- **02 Kernel visitor + report extension** *(→ DC-82)* — "maintain one renderer, so a
  kernel change is one edit and an unhandled component fails the build."
- **03 relation_filters** *(→ DC-83)* — "add a filter as a single row and query which
  relations filter on column X."
- **04 relation_columns** *(→ DC-84)* — "query which relations project column X across
  both views and reports in one place."
- **05 relation_joins** *(→ DC-85)* — "trust join order is preserved, and reorder joins
  by editing a sequence value."
- **06 relation_grain** *(→ DC-86)* — "inspect and compare a relation's grain as rows,
  not opaque JSON."
- **07 relation_aggregations + report rules** *(→ DC-87)* — "get a dimensionless or
  mart-to-mart report rejected at the boundary with a clear error."
- **08 Drop embedded-JSON columns** *(→ DC-88, `@infrastructure`)* — "run the model on
  one schema once the JSON bridge is no longer read."

---

## Release-slice bands (grouped by outcome)

The bands slice the ribs horizontally by the outcome each release delivers, not by
table. Each band is an independently valuable increment.

### R1 — Type-safety & unified rendering

**Outcome:** Report joins View on one typed kernel, and the model renders through a
single visitor. Malformed report columns are rejected at the boundary and a renderer
change is one edit with a build-time completeness check.

- **01 — Report-typed kernel** (activity A)
- **02 — Kernel visitor + report extension** (activity B)

### R2 — Normalized component tables

**Outcome:** Each component (filters, columns, joins, grain, aggregations) becomes an
individually-addressable, queryable row. Adds are single-row writes; components are
queryable across relations; join order is honored; report semantics are enforced over
typed rows.

- **03 — `relation_filters`** (activity C, pattern-prover)
- **04 — `relation_columns`** (activity C)
- **05 — `relation_joins`** (activity C)
- **06 — `relation_grain`** (activity C)
- **07 — `relation_aggregations` + report rules** (activity D)

### R3 — Contract

**Outcome:** The embedded-JSON columns are retired after one safe release; the schema
holds a single source of truth and the write-both bridge is removed.

- **08 — Drop embedded-JSON columns** (activity E, `@infrastructure`)

---

## No walking skeleton (intentional omission)

This map **deliberately draws no walking-skeleton line.** The product owner has
excluded it for this feature.

**Rationale (recorded):** Claude does not handle vertical (thin end-to-end) slices
well. Instead, this feature generates a **RED acceptance test per Scenario before
implementation**, and lets the **RED acceptance suite serve as the gate** — the
suite going green story-by-story is the safety mechanism a walking skeleton would
otherwise provide. There is therefore no "thinnest end-to-end slice" rib on this map.

There is also **no characterization / legacy-pin premise.** View and Report are
display-only in the UI today and the Agent → View/Report generation path has *not*
been integration-tested; there is **no production or legacy View/Report data** to pin
a render snapshot against. Render-equivalence is therefore proven **only** as a
self-contained in-test property — comparing the pre-normalization render path against
the post-normalization render path for a fixture **built inside the test** — never as
a golden snapshot of pre-existing seeded relations.

---

## Out of scope (feature non-goals, from ADR-052)

- Folding View/Report into the Dataset-staging `transforms` table (ADR-051 Finding 2 stands).
- Normalizing `source_refs` into a `relation_sources` table (OQ-1 — separable follow-on).
- An outbound operations → M renderer (admitted by the dispatch catalog, deferred).
- Reintroducing stored executable translation logic (rules-as-data stays rejected, ADR-026).

---

## Open questions routed to DISTILL/DELIVER (carried from ADR-052)

- **OQ-1** normalizing `source_refs` into `relation_sources` — separable follow-on, out of scope here.
- **OQ-2** `fact`/`dimension` `report_type` — structural or label? → DISTILL (Story 07).
- **OQ-3** `relation_grain` cardinality — one row per parent vs per key → DISTILL (Story 06).
- **OQ-4** polymorphic-cascade enforcement — repo path + CHECK vs trigger → DELIVER (Story 03 establishes, each later story inherits).
