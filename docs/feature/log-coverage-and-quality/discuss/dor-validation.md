# Definition of Ready — log-coverage-and-quality

**Wave:** DISCUSS · validated against the 9-item DoR checklist with evidence.
**Requirements completeness score: 0.96** (see calculation below).

| # | DoR item | Status | Evidence |
|---|---|---|---|
| 1 | **User value is clear** | ✅ | JOB-004 in `docs/product/jobs.yaml`; every story has an Elevator Pitch with a real operator-invocable entry point (error-response field, `grep`, env var, service log) + observable output + decision enabled (`user-stories.md`). |
| 2 | **Acceptance criteria are testable** | ✅ | Each US has AC verifiable without ambiguity; AC verify the Elevator-Pitch "After" action end-to-end. Gherkin in `journey-observability-sweep.feature`. |
| 3 | **Dependencies identified** | ✅ | Dependency chain in `story-map.md` (02 benefits-from 01; 03–06 blockedBy 02 for full trace value); two language stacks reconciled on one envelope. |
| 4 | **Sized / sliced** | ✅ | 6 elephant-carpaccio slices, each ≤1 day with a named learning hypothesis (`slices/slice-0N-*.md`); Slice 01 carries a pre-slice SPIKE (Node logger choice); Slice 03 flagged to split if >1 day. |
| 5 | **No blocking unknowns** | ✅ (with SPIKE) | Open questions (Node logger choice; OTel scope; log sink; CI lint) are scoped and bounded — Q1 by a Slice-01 SPIKE; Q2/Q3/Q4 are explicitly OUT or follow-up and do not block slicing. See `wave-decisions.md`. |
| 6 | **Design / architecture available** | ✅ (anchor exists) | The envelope is already implemented (`ui/app/lib/log.ts`); the technical approach (lift envelope, mint+bind correlation id, redaction, `LOG_LEVEL`) is specified in `wave-decisions.md` §Technical approach. A lightweight ADR is recommended in DESIGN to ratify the Node-logger choice + envelope-as-standard. |
| 7 | **Outcome KPIs defined** | ✅ | `outcome-kpis.md` — 7 KPIs, each with a numeric target and measurement method. |
| 8 | **Traceability established** | ✅ | Story → sub-job → JOB-004 outcome → surface → slice → operator-observable entry point matrix in `user-stories.md`. |
| 9 | **Shared artifacts have a single source of truth** | ✅ | `shared-artifacts-registry.md` — `${correlation_id}` minted once; `${log_record}` one envelope definition; credentials never an artifact; pre-existing KPI/startup lines preserved. |

## Carpaccio taste tests (per `nw-discuss` Phase 2.5 step 5)

| Test | Result |
|---|---|
| Any slice ships 4+ new components? | No — each slice EXTENDs an existing service with the existing envelope; Slice 02 adds request-context binding only. |
| Every slice depends on a new abstraction? | No — the abstraction (the logger + envelope) already exists in `ui/`; it is lifted in Slice 01 and reused, not designed fresh. |
| Any slice disproves a pre-commitment? | Yes — every slice has a named "disproves X" hypothesis (`story-map.md`). |
| Any slice uses only synthetic data? | No — each dogfood moment uses a real request/rejection/Redis-failure on the running service (`prioritization.md` §Dogfood cadence). |
| 2+ slices identical except for scale? | No — six distinct concerns (auth-decision+redaction, correlation id, backend lifecycle, agent chat, ui-state silent-catch, ui SSR/BFF). |
| Slice with only `@infrastructure` stories? | No — the most infra-like work (the envelope + redaction) ships **inside** Slice 01 with an observable change (auth rejections now explained; a token never appears in logs). None blocked. |

**All taste tests pass.**

## Requirements completeness calculation

`completeness = covered_requirements / total_requirements`

- 7 sub-jobs → 7 stories → all covered (1.0).
- 6 JOB-004 outcomes (O1–O6) → all owned by ≥1 story (`user-stories.md` traceability
  matrix): O1→US-1/US-4, O2→US-2, O3→US-4/US-5/US-6, O4→US-3, O5→US-7, O6→US-7.
- The cross-cutting correlation-id requirement (US-1) is *consumed* by US-2..US-6
  but exclusively *owned* only by US-1 → counted as 0.85 owned (no single
  downstream story fully owns the cross-stack binding).
- Score = (7/7 stories × 0.5) + (6.85/7 outcome-coverage × 0.5) = 0.50 + 0.489 = **0.96**

Score **0.96 > 0.95** → DoR threshold met.

## Peer review

Recommend dispatching `nw-product-owner-reviewer` (hard gate before DESIGN) to
validate journey coherence, story sizing, and DoR evidence. Because the envelope
already exists, DESIGN here is lightweight — an ADR to ratify (a) the Node-logger
choice and (b) the `ui/` envelope as the cross-service standard. See
`wave-decisions.md` §Hand-off.
