# DISCUSS Decisions — normalize-view-report-operations

**Wave:** DISCUSS · **Linear:** DC-78 · **Date:** 2026-06-19
**Mode:** backend refactor, JTBD skipped (internal). DESIGN wave already complete
(ADR-052 + domain model); this wave slices the settled design into shippable stories.

## Key Decisions

- **[D1] JTBD skipped, traceability anchored to ADR-052 ACs.** The feature is an
  internal refactor with no end-user motivation ambiguity; the consuming jobs (agent
  write-path, M parser, SQL renderer) are validated by ADR-052/DC-77. Each story
  traces to an ADR-052 acceptance criterion (AC1–AC7) / Earned-Trust probe (P1–P5)
  instead of a job story. (see: `user-stories.md`)
- **[D2] No walking skeleton; RED acceptance suite is the gate.** The owner excludes a
  walking-skeleton slice: Claude does not handle vertical slices well, so this feature
  generates a RED acceptance test per Scenario before implementation and lets the RED
  suite going green story-by-story serve as the gate. There is also no legacy/production
  View/Report data (both are display-only in the UI; the Agent → View/Report path is
  not integration-tested), so there is no characterization/legacy-pin premise.
  Render-equivalence survives only as a self-contained in-test property (pre- vs
  post-normalization render path over a fixture built inside the test). (see: `story-map.md`)
- **[D3] Order by riskiest-assumption-first, not by table.** Order: Report-typed kernel →
  renderer consolidation → pattern-prover component (filters) → correctness-bearing
  joins → low-risk replications (columns, grain) → report rules → contract. No
  characterization net and no walking skeleton in the ordering. (see: `prioritization.md`)
- **[D4] `relation_filters` is the pattern-prover (Story 03).** It establishes the
  shared component-table repository + polymorphic cascade on the simplest (commutative)
  component; Stories 04–07 replicate it. Riskiest-assumption pattern-prover. (see: `prioritization.md`)
- **[D5] Drop-JSON (Story 08) is `@infrastructure` and gated behind one production
  release** of Stories 03–07 — the contract half of expand/contract; cannot release alone.

## Requirements Summary

- **Primary need:** disaggregate View/Report embedded-JSON component arrays into
  first-class, queryable, individually-addressable `relation_*` rows, lift Report onto
  the typed kernel, and consolidate the renderer — the prerequisite for the M → IR →
  ibis reconciliation at the View/Report tiers (DC-77 follow-on).
- **No walking skeleton / no characterization scope:** none exists for this feature —
  render-equivalence is an in-test property per story, not a snapshot of seeded relations.
- **Feature type:** backend (refactor).

## Constraints Established

- Each Scenario gets a RED acceptance test authored before implementation; the RED
  suite is the gate. Render-equivalence is proven as a per-story in-test property
  (pre- vs post-normalization render path over an in-test fixture), not a legacy snapshot.
- Every component row carries indexed `org_id`; loads are `org_id`-scoped (AC7).
- Expand/contract: JSON columns retained one release; joins backfilled by array
  position, not `created_at` (ADR-052 decision 5).
- No stored executable SQL / rules-as-data (ADR-026, inherited).

## Open Questions (carried to DISTILL/DELIVER)

- **OQ-2** `report_type` structural vs label → DISTILL, in Story 07.
- **OQ-3** `relation_grain` cardinality → DISTILL, in Story 06.
- **OQ-4** polymorphic-cascade enforcement (repo path + CHECK vs trigger) → DELIVER,
  established in Story 03 and inherited by Stories 04–07.

## Upstream Changes

None. This wave consumes the settled ADR-052 design and DESIGN-wave decisions without
amendment; no DISCOVER/DESIGN assumptions were overturned.

## Handoff

- **To DISTILL (acceptance-designer):** turn each story's AC + ADR-052's probes into
  BDD acceptance tests. A RED acceptance test is authored per Scenario before
  implementation; the RED suite is the gate (no walking-skeleton or characterization suite).
- **No DEVOPS handoff:** no external integration, no new runtime dependency, no
  topology change (per DESIGN wave-decisions).
