# Solution Architect Review — DESIGN wave for J-002 (`project-and-chat-session-management`)

> **Reviewer**: nw-solution-architect-reviewer (Haiku)
> **Reviewed**: 2026-05-13
> **Iterations**: 2 (initial review: PASS WITH MINOR REVISIONS @ 94% confidence; final review after architect edits: PASS @ 97% confidence)
> **Artifacts reviewed**:
> - `docs/feature/project-and-chat-session-management/design/application-architecture.md`
> - `docs/feature/project-and-chat-session-management/design/wave-decisions.md`
> - `docs/feature/project-and-chat-session-management/design/c4-diagrams.md`
> - `docs/feature/project-and-chat-session-management/design/handoff-design-to-distill.md`

This document is the final reviewer report after the architect iterated against the initial findings. It captures: (1) the verdict + confidence; (2) the initial findings (HIGH, MEDIUM, LOW); (3) the specific edits the architect applied; (4) the final verification confirming all findings resolved.

---

## Final Verdict

**PASS** — Confidence: **97%**

The J-002 DESIGN wave is architecturally sound and respects all binding DISCUSS contracts (D1-D12). The four DESIGN artifacts are internally consistent, cite code accurately, resolve the two blocking open questions (OQ-J002-1: Option A column; OQ-J002-6: stale-intent guards), and map cleanly to the 12-state journey YAML.

The architecture reuses the existing substrate (ADRs 027-034) without mutations, introduces exactly 3 new files and 9 file extensions with clear CREATE NEW justifications (ADR-028:46-48 machine independence for the machine file; structural necessity for the agent scope helper), and establishes a machine-registry refactor (DWD-8) that unblocks future flows mechanically.

DESIGN is **ready for handoff to DISTILL**.

---

## Iteration 1: Initial Review (PASS WITH MINOR REVISIONS @ 94%)

### HIGH (blocks PASS)

**H1: Reuse Analysis (wave-decisions.md): Incorrect claim about ScopeResolver call-site context shape**

- **Issue**: The reuse-analysis table claimed "All J-002 call sites pass the same `(route, jwt, machineContext)` triple shape. Zero changes." and §8 of application-architecture.md claimed J-002 exercises invariants I1, I4, **I5**.
- **Reality (verified against `ui-state/lib/active-scope.ts:80-142`)**: the `machineContext` parameter defaults to `{}`; I5 (stale-link reconciliation for project-rename-while-bookmarked) only fires when `machineContext.{bookmarked_project_name, current_project_name}` are both populated. J-002's `J002MachineContext` type (§2.1) does NOT populate these fields, because none of US-201..US-210 describes a project-rename-while-bookmarked case. The J-002 deep-link failure modes are I4-shaped (cross_tenant, project_not_found, access_revoked).
- **Severity**: HIGH (clarity issue blocking unambiguous handoff to DISTILL)

### MEDIUM

**M1: c4-diagrams.md §3 — collapsed-state cross-reference missing**

- **Issue**: The state chart correctly omits `no_sessions_empty_state` as a separate XState state (per DWD-1) but does not cross-reference application-architecture.md §2.3's rationale.
- **Severity**: MEDIUM (documentation clarity)

**M2: application-architecture.md §4.1 — `extractActiveScope` sketch return-type**

- **Issue**: The function-signature sketch's return-type union shows a `from: "header" | "body_fallback_required"` path that didn't quite match the conceptual story. The reviewer asked for an explicit footnote that the signature is a sketch finalized in DELIVER MR-4.
- **Severity**: MEDIUM

### LOW

**L1: application-architecture.md §0 TL;DR — loader count ambiguity**

- **Issue**: TL;DR said "5 RRv7 loaders on five J-002-relevant routes" but the table in §6.2 listed 7 routes graduating (some sharing files). Terminology clarity.
- **Severity**: LOW

**L2: c4-diagrams.md §2 — j002factory `Rel()` clarity**

- **Issue**: The component diagram declared `j002factory` and listed two `Rel()` arrows, but their language could be tighter (the orchestrator doesn't "spawn" via the factory; it calls the factory which creates the machine).
- **Severity**: LOW

---

## Architect's Edits (iteration 1.5)

The architect applied all five edits:

| Finding | Location | Edit |
|---|---|---|
| H1 | `wave-decisions.md` §"Reuse Analysis" row 7 (`resolveActiveScope`) | Changed to **REUSE VERBATIM (default empty `machineContext`)** with full rationale: J-002 exercises I1, I3, I4 in PR-0 — NOT I5. The optional `machineContext` parameter is left at default empty object. Future J-NNN flows can populate I5 fields without resolver change. |
| H1 | `application-architecture.md` §8 (ScopeResolver invariants table) | `resolveInitialScope` row changed from `I1, I4, I5` to `I1, I4`. Added explanatory paragraph after the table: "**Invariant I5 (stale-link reconciliation for project-rename-while-bookmarked) is NOT exercised by J-002 in PR-0**" with mechanism + rationale + link to DWD-12. |
| M1 | `c4-diagrams.md` §3 | Added note block just above §3.1 cross-referencing application-architecture.md §2.3 for the `no_sessions_empty_state` collapse rationale (DWD-1). |
| M2 | `application-architecture.md` §4.1 | Added clarification at end of §4.1: "**The exact return-type union, error-handling semantics, and the body-fallback wiring will be finalized during DELIVER MR-4 based on the body-stream constraint; the DISTILL acceptance tests gate the externally-observable behavior (header-preferred read, 400 / 403 / fallback rules) rather than the internal function signature.**" |
| L1 | `application-architecture.md` §0 TL;DR bullet 5 | Changed from "RRv7 loaders on five J-002-relevant routes" to "RRv7 framework-mode route migrations — 7 J-002-territory routes graduate to loader-bearing modules across 5 files (`root.tsx`, `routes/projects.tsx`, `routes/project-detail.tsx` [two route IDs share this file], `routes/chat.tsx` [two route IDs share this file], `routes/sessions.tsx`). Per DWD-4 the migration is staged across Slices 1 + 2." |
| L2 | `c4-diagrams.md` §2 — Rel arrows | Updated to "<<NEW>> Calls factory on principal's first J-002 event OR on J-001 ready broadcast" and "<<NEW>> Creates machine instance per (flow_id, principal_id) — setup({actors}).createMachine pattern per ADR-028" |

---

## Iteration 2: Final Review (PASS @ 97%)

The reviewer re-read all four artifacts after the edits. All five findings are confirmed resolved:

- **H1 fully resolved**: The reuse-analysis row now correctly clarifies the I5 non-exercise; §8 of application-architecture.md no longer claims I5 exercise.
- **M1 addressed**: Cross-reference between c4-diagrams.md §3 and application-architecture.md §2.3 in place.
- **M2 addressed**: Function-signature sketch footnote added at §4.1.
- **L1 addressed**: TL;DR bullet 5 now specifies "7 J-002-territory routes across 5 files" with Slices 1+2 staging.
- **L2 addressed**: `j002factory` Rel arrows now use precise ADR-028 pattern language.

No residual issues block approval.

---

## Specific verifications performed (across both iterations)

### 1. DISCUSS Contract Fidelity (HARD GATE)

- **D8 (agent-stays-stateless)**: Verified application-architecture.md §4. ✓
- **D9 (J-002 owns multi-turn state)**: Verified §0 and §2. ✓
- **D10 (org-switching deferred)**: Verified §0. ✓
- **D11 (session_metadata schema delta)**: Verified DWD-2 resolves OQ-J002-1 to Option A. ✓
- **D12 (slug)**: Verified all references use `project-and-chat-session-management`. ✓

### 2. ADR Conformance

- **ADR-028:46-48 (no machine-to-machine imports)**: Verified §3.4. ✓
- **ADR-029 invariants 1-5**: Verified §8 maps J-002 call sites to I1, I3, I4 (correctly excluding I5 after the iteration-1.5 edit). ✓
- **ADR-027 §4 (FlowProjection envelope)**: Verified §7.1 + DWD-9. ✓
- **ADR-034 (RRv7 framework mode)**: Verified §6 references `web-ssr` container + RRv7 framework mode names correctly. ✓
- **ADR-031 §7 (auth path)**: Verified §6.1. ✓

### 3. Reuse Analysis (HARD GATE)

- Verified wave-decisions.md §"Reuse Analysis" table covers 14 rows.
- All EXTEND/CREATE NEW entries have structural justification.
- 3 new files identified (machine, scope.ts, migration 009). ✓

### 4. Internal Consistency Across 4 Artifacts

- **State list match**: application-architecture.md §2.4 (14 states) ↔ c4-diagrams.md §3 (chart 14 states). ✓
- **Per-slice mapping match**: application-architecture.md §9 ↔ handoff-design-to-distill.md "MR-by-MR scope mapping". ✓
- **DWD references resolved**: All DWD-1..DWD-12 cited in application-architecture.md resolve to entries in wave-decisions.md. ✓
- **6 sequence diagrams**: c4-diagrams.md §4 covers slices 1-6 happy paths. ✓

### 5. Code-Surface Citation Accuracy (Sampling)

- `ui-state/lib/orchestrator.ts:104-107` (hardcoded conditional) ✓
- `ui-state/lib/projection.ts:107-242` (EVENT_HANDLERS strategy table) ✓
- `ui-state/lib/active-scope.ts:80-142` (pure resolver) ✓
- `agent/lib/chat/handleChat.ts:75` (reads project_id from body) ✓
- `backend/app/use_cases/session/update_session.py:50-52` (allowlist line) ✓
- `frontend/app/root.tsx` (no root loader today) ✓
- `frontend/app/routes.ts` (12 routes; 7 J-002-territory) ✓

### 6. Critical-Path Completeness

- **OQ-J002-1** resolved in DWD-2 (Option A column). ✓
- **OQ-J002-6** resolved in DWD-7 (per-intent stale guards; silent-drop semantics). ✓
- 7 risks (R1-R9) addressed across the artifacts. ✓
- Per-route loader-graduation in DWD-4 covers all J-002-territory routes. ✓
- Agent X-Active-Scope migration window has compile-time sunset (DWD-3). ✓

### 7. Design-Wave Hygiene

- No machine implementation. ✓
- No acceptance tests. ✓
- No production code changes. ✓
- No re-litigation of D1-D12. ✓
- No J-003+ scope. ✓

---

## Recommendation

The DESIGN wave is complete and ready for handoff to DISTILL. The architect should:

1. **Commit the four DESIGN artifacts + this review report** to `design/project-and-chat-session-management` branch.
2. **Push to `origin/design/project-and-chat-session-management`**.
3. **Submit via `gt mq submit --branch design/project-and-chat-session-management`** from the rig workspace; the refinery's `--auto` gate will detect docs-only diff and merge in seconds.
4. **Hand off to DISTILL** — the acceptance-designer can begin formalizing the 62 scenarios across 10 test files immediately upon merge.

No further DESIGN iterations are needed.

---

## Sign-off

**Reviewer**: nw-solution-architect-reviewer (Haiku) | **Verdict**: PASS | **Confidence**: 97% | **Iterations**: 2 (HIGH issue + 4 minor revisions resolved in iteration 1.5)
