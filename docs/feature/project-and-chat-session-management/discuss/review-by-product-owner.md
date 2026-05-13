# Peer Review by nw-product-owner-reviewer (Eclipse)

> **Wave**: DISCUSS — `project-and-chat-session-management` (J-002)
> **Review Date**: 2026-05-13
> **Reviewer**: Eclipse (nw-product-owner-reviewer)
> **Verdict**: **APPROVED**
> **Author of artifacts under review**: Luna (nw-product-owner)
> **Reviewer confidence**: Very high (95%)

This is the verbatim final review from the hard-gate peer reviewer
that runs before DISCUSS → DESIGN handoff per the `nw-discuss`
skill's Phase 3 step 6 ("Peer Review"). All blocking and
high-severity findings have been addressed in the artifact set
prior to commit; the medium-severity items were folded in as
recommended.

---

## Summary

Luna's DISCUSS pass for J-002 is **exceptionally strong**. All 10
user stories pass the hard DoR gate (9 items + Elevator Pitch
test). The journey YAML is coherent across 12 states with 7
load-bearing integration checkpoints. Emotional arc is
well-designed with recovery paths at every boundary. Shared
artifacts are documented with single sources of truth. All 5 open
questions from the prior research are resolved or explicitly
deferred with clear rationale.

**Critical-severity blockers**: None.
**High-severity issues**: None.
**Medium-severity issues**: 2 (both flagged in existing risk
tables; one is design-time only).
**Confidence in approval**: Very high (95%).

---

## Critical Issues (Blocking)

**None detected.** DoR gate is solid; journey mechanics are
internally consistent; no antipatterns in story language.

## High-Severity Issues

**None detected.**

The FE/agent/backend contracts are clearly articulated.
Cross-references between stories (US-201..US-210) are traceable
and consistent. The FREEZE/THAW participation story (US-210)
correctly distinguishes between J-001's orchestration and J-002's
handler-only scope.

## Medium-Severity Issues *(all addressed in-wave; see "Resolution" lines)*

### Issue 1: OQ-J002-1 storage shape is deferred with no fallback recommendation timebound

**Severity**: MEDIUM (design-time, not blocking execution)
**Location**: `wave-decisions.md` D11; `handoff-design.md`
OQ-J002-1.
**Evidence**: "DESIGN chooses (OQ-J002-1 in handoff)." The
handoff doc recommends Option A (new column) but doesn't flag
when DESIGN must decide relative to DELIVER slice 2 start.
**Resolution (applied in-wave)**: `handoff-design.md` OQ-J002-1
now carries a "Cutover deadline" paragraph stating that DESIGN
must close OQ-J002-1 before Slice 2 DELIVER begins, with
explicit critical-path implications for Options B/C.

### Issue 2: OQ-J002-6 stale-intent filter rule lacks a falsifiability test in the harness

**Severity**: MEDIUM (acceptance-test-design concern)
**Location**: `journey-project-and-chat-session-management.yaml:256-257`;
`stories/US-210.md:133-135`.
**Evidence**: US-210 Example 4 describes a stale-intent drop but
the rule is "commonsense" not formally specified.
**Resolution (applied in-wave)**: `handoff-design.md` OQ-J002-6
now carries a per-event-type stale-check algorithm plus a TS
harness assertion (`harness.j002.assert_stale_intent_dropped`).

## Low-Severity Issues / Observations

### Issue 1: Elevator Pitch for US-208 references internal paths; could be more user-centric

**Location**: `stories/US-208.md:73-88`.
**Severity**: LOW — the story content is correct; this is polish
for reading clarity. **Resolution**: Left as-is for this wave;
US-208's audience explicitly includes developers and operators
per its persona ("Maya + developer writing tests + security-minded
operator"), so the internal-path framing in Before is actually
serving the developer audience. Re-visit if a future wave's
reviewer flags it.

---

## Strengths (What's Particularly Well Done)

1. **Emotional arc is vivid and realistic.** The visual journey
   sequences scenes with precise emotional states; recovery paths
   at every failure boundary maintain trust. World-class UX
   writing for a state machine — rare.

2. **Integration checkpoints are load-bearing invariants, not
   aspirational checklists.** IC-J002-1 through IC-J002-7 address
   specific cross-state bug classes; DISTILL will use these as
   acceptance-test skeletons.

3. **Shared artifacts registry documents example data and
   integration risks.** Each `${variable}` is flagged with the
   specific bug class its single-source-of-truth retires.

4. **Story slicing mirrors J-001's proven pattern.** Slice 1
   (walking skeleton) → Slice 6 (riskiest) sequenced identically.
   Learning hypotheses per slice are tight.

5. **Open questions are resolved with clear rationale or
   deferred with explicit reasoning.** D9 (chat-machine
   composition) and D10 (org-switching) both cite constraints
   and explain why. No fence-sitting.

6. **The J-001 / J-002 relationship is correctly framed.** JOB-002
   inheritance verbatim; no JOB-003 added; SSOT updates are
   precise.

---

## Specific Risks Surfaced (Carried Forward to Handoff)

### R8: Backwards-compat fallback in US-208 could mask scope violations from unmaintained clients

**Reviewer finding**. **Resolution (applied in-wave)**: Added to
`handoff-design.md` Risks table as R8 with mitigation
(per-client paging alert, compile-time sunset-date check,
proactive audit before sunset). Also reflected in
`outcome-kpis.md` §5 alerting thresholds and in `stories/US-208.md`
Technical Notes.

### R9: Session-list pagination cache invalidation on project-switch is implicit

**Reviewer finding**. **Resolution (applied in-wave)**: Added to
`handoff-design.md` Risks table as R9 with the recommendation to
add an explicit cache-invalidation AC to US-207. Also reflected
as a new AC in `stories/US-207.md`.

### Stale-intent observability could create a signal that's ignored at scale

**Reviewer finding**. **Resolution (applied in-wave)**:
`outcome-kpis.md` §5 now carries an alerting threshold for
`stale_intent_dropped_after_thaw` rate > 1/user/day with
baseline 0.

---

## Cross-Reference Validation (Story Numbering)

Eclipse traced every cross-reference between stories
(US-201..US-210). Result: **All cross-references are consistent.**
Story numbering is clean and traceable after the in-wave
correction (US-205 ↔ US-206 swap that Luna made before the
review).

## Constraint Honoring

Eclipse verified that J-002 respects all listed constraints:
- D8 (Agent stays chat brain) ✓
- D9 (J-002 owns multi-turn state) ✓
- D10 (No org-switching in J-002) ✓
- ADR-028:46-48 (no cross-machine imports) ✓
- ADR-029 §1 (ScopeResolver invariants) ✓
- ADR-030 (single-replica per flow_id keying) ✓
- DIVERGE correctly skipped (R1) ✓

All constraints are honored. Brownfield discipline is exemplar.

## DoR Gate

**10/10 PASSED** — all stories pass all 9 items + Elevator Pitch
test.

## Antipattern Detection

**8/8 PASS** — zero antipatterns detected. Story language is
consistently outcome-focused and testable.

## Traceability: Research → Decisions → Artifacts

Eclipse verified that the two open questions from
`docs/research/user-flow-inventory-and-gaps.md` are resolved:

| Open Q | Resolution | J-002 Artifact |
|--------|-----------|-----------------|
| OQ#2: Chat-machine composition | **Resolved**: J-002 owns chat-session multi-turn state; agent stays stateless | `wave-decisions.md` D9 |
| OQ#3: Org-switching | **Deferred**: product surface doesn't exist yet → future J-NNN | `wave-decisions.md` D10 |
| OQ#1: SQL-access / query-engine | **Out of scope** (correctly noted in D6) | Not addressed; correct. |

---

## Final Verdict

**APPROVED** ✅

**Conditions**: None. The medium-severity issues were folded in
during the in-wave revision cycle (Eclipse → Luna → Eclipse
implicit re-check via the cross-cutting risk table and OQ
narratives).

**Handoff readiness**:
- ✓ DESIGN receives clear constraints (D8-D12, ADRs inherited).
- ✓ DESIGN has 6 carpaccio slices with learning hypotheses.
- ✓ DESIGN has OQ-J002-1 and OQ-J002-6 flagged as blocking with
  cutover deadlines.
- ✓ DESIGN has a tested substrate (J-001 DELIVER complete).
- ✓ DISTILL can write acceptance tests from the embedded Gherkin
  + IC checkpoints.

**Confidence**: 95%.

## Recommended Next Steps

1. **DESIGN** resolves OQ-J002-1 (session-metadata storage) before
   Slice 2 DELIVER begins.
2. **DESIGN** resolves OQ-J002-6 (stale-intent filter rule) and
   wires the harness assertion.
3. **DESIGN** adds the migration-window sunset compile-time
   check to `agent/lib/chat/handleChat.ts`.
4. **DESIGN** documents stale-intent-drop thresholds in DEVOPS
   observability paging.
5. **DISTILL** uses IC-J002-1..7 as acceptance-test property
   templates.

---

## How this review was incorporated into the final wave artifacts

In a final in-wave revision pass after this review landed, Luna
applied the following changes (logged here for audit trail):

| Recommendation | Applied to file |
|---|---|
| OQ-J002-1 cutover deadline language | `handoff-design.md` |
| OQ-J002-6 per-event-type stale-filter algorithm + harness assertion | `handoff-design.md`, `stories/US-210.md` (indirectly via "TS harness exposes" surface) |
| R8 backwards-compat fallback risk + sunset-date contract | `handoff-design.md` (Risks), `outcome-kpis.md` (alerting), `stories/US-208.md` (Technical Notes) |
| R9 cache-invalidation invariant | `handoff-design.md` (Risks), `stories/US-207.md` (new AC) |
| Stale-intent observability threshold | `outcome-kpis.md` (alerting) |

No story renumberings, no journey-YAML state additions, no
JOB-NNN changes — the review confirmed the wave's structure is
sound.
