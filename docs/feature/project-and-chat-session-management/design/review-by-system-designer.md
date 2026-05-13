# System Designer Review — DESIGN wave for J-002 (`project-and-chat-session-management`)

**Reviewer:** Praxis (nw-system-designer-reviewer — foreground complementary pass)
**Reviewed:** 2026-05-13
**Verdict:** **PASS-WITH-CLARIFICATIONS**
**Scope of this review:** system-level (topology, persistence, scalability, failure modes, backend schema migration, agent contract cutover, DISTILL handoff). The in-wave reviewer was Luna (`nw-solution-architect-reviewer`, application scope, PASS @ 97%); this is the complementary system-scope pass mirroring the frontend-coexistence Praxis pattern.

The J-002 DESIGN is **system-ready after addressing 3 medium-severity items** that compound across the agent-backend integration, frontend loader fan-out, and backward-compat window management. No blocking issues. The architecture extends cleanly: 1 new machine sibling, 3 new files, 9 file extensions, 0 new external integrations. The machine-registry refactor (DWD-8) is sound and unblocks future J-003+ flows mechanically. Two of the three clarifications (F-1 / F-2 / F-3) are addressed inline before this report's commit; F-4 / F-5 are DISTILL-side concerns.

## §1 Overall verdict

**PASS-WITH-CLARIFICATIONS** — design is system-ready after F-1/F-2/F-3 inline amendments (this MR addresses them). F-4 / F-5 are DISTILL-side test-coverage concerns.

## §2 Dimension grades

| Dimension | Grade | Notes |
|---|---|---|
| Inheritance fidelity (ADRs 027–030, 034; DISCUSS D1–D12) | A | Zero deviations from binding contracts. Luna's iteration confirmed I5 invariant non-exercise is correct (future J-NNN populates fields without resolver change). |
| Topology coherence | A- | Container/component/sequence diagrams are precise. Open question on `j001_ready` broadcast hook lineage (F-1). |
| Failure mode coverage | B+ | DWD-7 stale-intent guards specified; reversibility property held. Agent contract cutover lacks deprecation mechanics (F-2). |
| Scalability | A- | Per-flow Redis stream + agent-header payload + backend schema all within budget. Frontend loader fan-out needs coordination with Phase 04 (F-3). |
| Backend schema migration plan | A | Migration 009 is forward-only, nullable, indexed, slice-internal-ordered. No surprises. |
| Agent contract cutover | B | Header-preferred + body-fallback + compile-time sunset is innovative; mechanical details underspecified (F-2). |
| DISTILL handoff completeness | A | Exemplary. MR-by-MR scope table + TS harness operations + 62 scenarios + 7 ICs + risk registry. |

## §3 Findings

### F-1 — Orchestrator `j001_ready` broadcast hook lineage unclear

- **Severity:** HIGH (clarity — affects DISTILL's spawning assertion)
- **Location:** `wave-decisions.md` DWD-6, `c4-diagrams.md` §2 + sequence diagrams §4.1–4.6
- **Issue:** DWD-6 and the sequence diagrams assume the orchestrator emits a `j001_ready` event when J-001 transitions to `ready`. The live orchestrator (`ui-state/lib/orchestrator.ts`) has a `priorState` watcher but no explicit broadcast hook. The design does not state whether this is (a) a new hook landing in MR-1, or (b) an existing hook not yet documented in the code survey.
- **Recommended resolution:** Add one sentence to DWD-6 stating: "The orchestrator's `j001_ready` broadcast hook does not exist in live code; MR-1 DELIVER lands it as part of the MachineRegistry refactor at the same lifecycle point the `priorState` watcher observes J-001's ready entry. Until then, J-002 does not auto-spawn on J-001 ready." Not a code gap — a documentation clarification so DISTILL can correctly assert on J-002 auto-spawn vs. manual-spawn-on-first-event.
- **Status:** ✅ Resolved inline (this MR).

### F-2 — Agent backward-compat deprecation procedure underspecified

- **Severity:** HIGH (clarity — affects MR-4 DELIVER engineer's execution safety)
- **Location:** `wave-decisions.md` DWD-3, `application-architecture.md` §4.1
- **Issue:** DWD-3 specifies the compile-time sunset check and flag-enabled state but leaves three mechanical questions unanswered: (1) Does the flag persist indefinitely after the sunset date, or auto-disable? (2) If the flag is removed post-sunset, does a revert of that removal break the build? (3) What is the 400 error body returned to clients that send body `project_id` without the header post-sunset?
- **Recommended resolution:** Add a §4.1.1 "Deprecation window mechanics" subsection to `application-architecture.md` specifying:
  - Flag persists in the codebase until the MR-4 engineer explicitly removes it (no auto-disable; the compile-time sunset check is the forcing function).
  - The check uses `if (Date.now() >= SCOPE_HEADER_FALLBACK_SUNSET.getTime() && process.env.SCOPE_HEADER_FALLBACK_ENABLED === "true") throw new Error(...)` so reverts post-sunset fail at startup.
  - Post-sunset 400 error body: `{error: "missing X-Active-Scope header", hint: "client version < X.Y.Z not supported after {date}", docs: "<link>"}`.
  - The MR-4 engineer sets a calendar reminder for 6 weeks post-merge to remove the flag.
- **Status:** ✅ Resolved inline (this MR).

### F-3 — Loader fan-out cumulative load not budgeted against Phase 04

- **Severity:** MEDIUM (coordination issue with parallel work stream)
- **Location:** `wave-decisions.md` DWD-4, `handoff-design-to-distill.md` "Open items"
- **Issue:** J-002 graduates 7 routes to RRv7 framework mode across Slices 1–2, introducing 5–7 new loader functions. Each loader = one HTTP round-trip to auth-proxy + one to ui-state. The concurrent Phase 04 work (`slate` crew, auth-proxy scaling) is in flight. No quantification of whether Phase 04's budget accounts for J-002's loader multiplication.
- **Recommended resolution:** Add O7 to `handoff-design-to-distill.md` "Open items DISTILL may surface":
  > **O7 — Loader fan-out coordination (MEDIUM)**: The slate crew's Phase 04 auth-proxy scaling work budgets for J-001's 4 loaders. J-002 adds 6–7 loaders across Slices 1–2. Before MR-1 DELIVER, confirm with slate that auth-proxy capacity is final. Fallback: defer `root.tsx` loader to Slice 2 if Phase 04 capacity is not yet green, reducing Slice 1 to 4 loaders.
- **Status:** ✅ Resolved inline (this MR).

### F-4 — Stale-intent filter rule incomplete for concurrent dataset picks during FREEZE

- **Severity:** MEDIUM (test coverage boundary)
- **Location:** `wave-decisions.md` DWD-7
- **Issue:** DWD-7's stale-intent filter specifies rules per intent type, but the rule for `dataset_resolved_by_agent` / `dataset_picked_directly` assumes "the target dataset is accessible" as the staleness condition. The design does not specify what happens if **two dataset picks queue concurrently during FREEZE** — which one wins? FIFO replay implies last-write-wins, but the guard condition (ScopeResolver invariant 4) must pass for both picks to be honored.
- **Recommended resolution:** Deferred to DISTILL. The acceptance test for US-209 (or a separate concurrent-picks scenario in `test_us210_freeze_thaw_replay.py`) should verify: "On THAW, dataset intents replay in FIFO order. If intent N passes the staleness guard (ScopeResolver I4 OK) and intent N+1 fails (dataset deleted or cross-tenant), the project + resource context for intent N persist — intent N+1 is silent-dropped."
- **Status:** Deferred to DISTILL.

### F-5 — Cross-machine `org_id` inheritance window (IC-J002-1) not guarded by assertion

- **Severity:** LOW (future validation)
- **Location:** `handoff-design-to-distill.md` "Known cross-machine coupling" §2, "IC-J002-1"
- **Issue:** DWD-6 + handoff say J-002's machine context reads `org_id` from the orchestrator's `j001_ready` broadcast. But J-002's `resolving_initial_scope` entry-action calls `resolveActiveScope(route, jwt, {})` and the `org_id` comes from the JWT. The design assumes JWT and J-001-broadcast `org_id` are identical, but if they diverge (e.g., JWT re-issue during org-switching), J-002 could populate a stale `org_id`. This is an implicit assumption that IC-J002-1 should assert.
- **Recommended resolution:** Deferred to DISTILL. The acceptance test for IC-J002-1 should assert: "J-002's `context.org_id` at `resolving_initial_scope` entry equals the JWT's decoded `org_id` claim AND equals the J-001 projection's `active_scope.org_id` at the same `sequence_id` boundary (within 100ms for clock skew)." Property test, not scenario test; important for multi-org safety (future J-NNN).
- **Status:** Deferred to DISTILL.

## §4 What's particularly strong

1. **Machine-registry refactor (DWD-8) is mechanically sound and scales to N flows.** The strategy table replaces a hardcoded conditional with zero coupling. J-003+ can plug in trivially. Exemplary brownfield extension.

2. **ScopeResolver invariant exercise is mapped end-to-end.** The design correctly identifies that J-002 exercises invariants I1, I3, I4 (not I5), with I5 deferred to future flows. Precision-level architectural reasoning. Luna's iteration and the architect's edit confirm the mapping is accurate.

3. **Backward-compat window mechanics are innovative.** The compile-time check `Date.now() < SCOPE_HEADER_FALLBACK_SUNSET.getTime()` is a rare example of forcing-function deprecation policy. No hand-waving about "the flag will be removed eventually" — the engineer landing MR-4 sets the date and the code enforces it.

## §5 Recommendation for DISTILL handoff

**The handoff document is exemplary and DISTILL may proceed.** DISTILL should additionally validate:

- **Per F-1 clarification (now inline):** Assert that J-002 actor spawns either (a) on the first J-002 event from the FE, or (b) on the orchestrator's `j001_ready` broadcast. Document which path is taken in the code.
- **Per F-2 clarification (now inline):** The MR-4 DELIVER engineer should set the literal `SCOPE_HEADER_FALLBACK_SUNSET` date in code and add a calendar item for flag removal ~6 weeks post-merge.
- **Per F-3 clarification (now inline):** Coordinate with slate crew (Phase 04) before MR-1 ships.
- **Per F-4 (deferred):** Add an explicit test scenario for concurrent dataset picks during FREEZE with FIFO + staleness-guard semantics.
- **Per F-5 (deferred):** Add a property-tagged scenario to `test_journey_invariants_j002.py` (IC-J002-1) asserting `context.org_id` consistency across J-001 and J-002 projections.

## §6 Reviewer constraints

### What I did NOT challenge (by binding scope)

- **All six DISCUSS wave-decisions D1–D12** — these stand. No re-litigation.
- **All binding ADRs (027/028/029/030/034)** — including the inheritance chain (014/015/018/031). ADR-034 frontend-coexistence is also referenced correctly.
- **Luna's application-scope PASS @ 97%** — her review validates journey contract, AC, interaction patterns. This review complements it at the system level.
- **The 14-state machine structure (DWD-1)** — flat-compound choice is a tested XState idiom. No evidence of a better option.
- **The per-slice walking-skeleton vs milestone shape** — carpaccio slicing is a proven pattern from J-001.

### What was in-scope for this review

- System-level topology coherence (new machine placement, cross-machine signaling, agent contract cutover, registry refactor).
- Scalability (per-flow memory, Redis stream multiplication, agent-header payload growth, loader fan-out compounding with frontend-coexistence Phase 04).
- Backend schema migration safety (alembic chain compatibility, online migration shape, existing-session handling).
- Failure mode coverage (SPOFs, reversibility, backwards-compat windows).
- Inheritance fidelity (all ADRs honored, no drift).
- DISTILL handoff completeness (actionability for the next wave).

## §7 Resolution log

The three actionable findings F-1 / F-2 / F-3 are addressed inline in this same MR:

- **F-1:** ✅ DWD-6 in `wave-decisions.md` gains a one-paragraph clarification about the orchestrator hook lineage (hook lands in MR-1 alongside the registry refactor).
- **F-2:** ✅ `application-architecture.md` §4.1 gains a §4.1.1 "Deprecation window mechanics" subsection specifying flag lifecycle, compile-time check syntax, and post-sunset 400 error body.
- **F-3:** ✅ `handoff-design-to-distill.md` "Open items" gains O7 about Phase 04 coordination and the `root.tsx` loader deferral fallback.

**F-4 / F-5 deferred to DISTILL** with scenario-level resolutions specified in §5 above.

Recommend proceeding to DISTILL wave.
