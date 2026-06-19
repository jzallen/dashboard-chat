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
- **[D2] Walking skeleton = the render-equivalence characterization harness (slice 00).**
  The brownfield analog to a walking skeleton; ADR-052's handoff makes it a hard gate
  before the renderer merge. (see: `story-map.md`)
- **[D3] Slice by safety dependency, not by table.** Order: char net → typing debt →
  renderer consolidation → per-component persistence swap (expand/contract) → contract.
  (see: `prioritization.md`)
- **[D4] `relation_filters` is the pattern-prover (slice 03).** It establishes the
  shared component-table repository + polymorphic cascade on the simplest (commutative)
  component; 04–07 replicate it. Highest learning leverage. (see: `prioritization.md`)
- **[D5] Drop-JSON (slice 08) is `@infrastructure` and gated behind one production
  release** of slices 03–07 — the contract half of expand/contract; cannot release alone.

## Requirements Summary

- **Primary need:** disaggregate View/Report embedded-JSON component arrays into
  first-class, queryable, individually-addressable `relation_*` rows, lift Report onto
  the typed kernel, and consolidate the renderer — the prerequisite for the M → IR →
  ibis reconciliation at the View/Report tiers (DC-77 follow-on).
- **Walking skeleton scope:** characterization snapshot of every seeded relation's
  compiled SQL (slice 00).
- **Feature type:** backend (refactor).

## Constraints Established

- Render-equivalence char test MUST exist before the renderer merge (slice 00 blocks 02).
- Every component row carries indexed `org_id`; loads are `org_id`-scoped (AC7).
- Expand/contract: JSON columns retained one release; joins backfilled by array
  position, not `created_at` (ADR-052 decision 5).
- No stored executable SQL / rules-as-data (ADR-026, inherited).

## Open Questions (carried to DISTILL/DELIVER)

- **OQ-2** `report_type` structural vs label → DISTILL, in slice 07.
- **OQ-3** `relation_grain` cardinality → DISTILL, in slice 06.
- **OQ-4** polymorphic-cascade enforcement (repo path + CHECK vs trigger) → DELIVER,
  established in slice 03 and inherited by 04–07.

## Upstream Changes

None. This wave consumes the settled ADR-052 design and DESIGN-wave decisions without
amendment; no DISCOVER/DESIGN assumptions were overturned.

## Handoff

- **To DISTILL (acceptance-designer):** turn each story's AC + ADR-052's probes into
  BDD acceptance tests. Slice 00's characterization suite is authored first (gate).
- **No DEVOPS handoff:** no external integration, no new runtime dependency, no
  topology change (per DESIGN wave-decisions).
