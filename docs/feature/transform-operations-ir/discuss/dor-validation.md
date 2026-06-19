# Definition of Ready — transform-operations-ir

**Wave:** DISCUSS · validated against the 9-item DoR checklist with evidence.
**Requirements completeness score: 0.97** (see calculation below).

| # | DoR item | Status | Evidence |
|---|---|---|---|
| 1 | **User value is clear** | ✅ | JOB-003 in `docs/product/jobs.yaml`; every story has an Elevator Pitch with a real endpoint + observable output + decision enabled (`user-stories.md`). |
| 2 | **Acceptance criteria are testable** | ✅ | Each US has AC verifiable without ambiguity; AC verify the Elevator-Pitch "After" command end-to-end. Gherkin in `journey-transform-operations-ir.feature`. |
| 3 | **Dependencies identified** | ✅ | Dependency chain in `story-map.md` (04←03, 05←02, 05 benefits 03); composes with ADR-007/026. |
| 4 | **Sized / sliced** | ✅ | 5 elephant-carpaccio slices, each ≤1 day with a named learning hypothesis (`slices/slice-0N-*.md`); two carry a pre-slice SPIKE (01, 05). |
| 5 | **No blocking unknowns** | ✅ (with SPIKEs) | Two open questions (sequence formula; outbound M timing) are scoped to DISTILL/DELIVER and bounded by SPIKEs; neither blocks slicing. ADR-051 §Open questions. |
| 6 | **Design / architecture available** | ✅ | DESIGN merged: ADR-051 + `design/evaluation.md` + `design/c4-component.md`. Reuse Gate PASS. |
| 7 | **Outcome KPIs defined** | ✅ | `outcome-kpis.md` — 7 KPIs, each with a numeric target and measurement method. |
| 8 | **Traceability established** | ✅ | Story → sub-job → JOB-003 outcome → ADR-051 decision → ADR-051 AC → slice → endpoint matrix in `user-stories.md`. |
| 9 | **Shared artifacts have a single source of truth** | ✅ | `shared-artifacts-registry.md` — every `${artifact}` has one owner; ordering source unified on `${sequence}`; derived artifacts flow outbound only. |

## Carpaccio taste tests (per `nw-discuss` Phase 2.5 step 5)

| Test | Result |
|---|---|
| Any slice ships 4+ new components? | No — each slice is an EXTEND of an existing component (Reuse Gate PASS); Slice 04 adds 2 sparse tables only. |
| Every slice depends on a new abstraction? | No — the abstraction (dispatch catalog) is shipped **first as its own slice** (03), per the carpaccio rule. |
| Any slice disproves a pre-commitment? | Yes — every slice has a named "disproves X" hypothesis (`story-map.md`). |
| Any slice uses only synthetic data? | No — Slices 01/03/04/05 require production-derived data (existing datasets' transforms; a real exported M script). |
| 2+ slices identical except for scale? | No — five distinct concerns (ordering, validation, catalog, sidecars, import). |
| Slice with only `@infrastructure` stories? | No — US-3 (the closest to infra) ships an observable developer artifact: a build-failing completeness probe. None blocked. |

**All taste tests pass.**

## Requirements completeness calculation

`completeness = covered_requirements / total_requirements`

- 5 sub-jobs → 5 stories → all covered (1.0)
- 7 ADR-051 acceptance criteria → 6 directly owned by a story; the cross-cutting
  Reproducibility-invariant AC is satisfied jointly (US-1+US-3+US-4) and wired as
  a continuous probe → counted as 0.85 owned (no single story exclusively owns it).
- Score = (5/5 stories × 0.5) + (6.85/7 ADR-AC × 0.5) = 0.50 + 0.489 = **0.97**

Score **0.97 > 0.95** → DoR threshold met.

## Peer review

Recommend dispatching `nw-product-owner-reviewer` (hard gate before DESIGN) — but
note **DESIGN is already complete and merged** for this feature, so the gate here
is "ready for DISTILL," not "ready for DESIGN." See `wave-decisions.md` §Wave
ordering note.
