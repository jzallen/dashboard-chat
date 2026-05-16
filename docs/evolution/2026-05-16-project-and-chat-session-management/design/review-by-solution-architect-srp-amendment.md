# Review: J-002 SRP Amendment (DWD-13)

**Reviewer**: nw-solution-architect-reviewer (dispatched by overseer)
**Date**: 2026-05-13
**Scope**: DESIGN amendment splitting J-002 into `project-context` + `session-chat`. Reviewing `wave-decisions.md` DWD-13, `application-architecture.md` (preamble + §0–§3, §6–§9, §13), `c4-diagrams.md` (§1–§3), and `handoff-design-to-distill.md` SRP amendment addendum against the binding SRP review (`review-by-software-crafter-srp.md`), ADR-028, ADR-029, ADR-030, the DISCUSS wave-decisions (D1–D12, IMMUTABLE), and the 10 user stories (IMMUTABLE).

---

## TL;DR

**APPROVED** with one administrative note (no blockers). The amendment correctly executes the SRP review's proposed split of the single 14-state machine into two cohesive sibling machines. The seam (project-context/session-chat boundary) is clean, the `project_ready` broadcast hook is correctly idempotent, cross-machine FREEZE/THAW semantics are sound, error_recoverable is correctly per-machine, and `switching_dataset_context` rightfully lives in session-chat. The amendment respects ADR-028 (no cross-machine imports; orchestrator mediation), ADR-029 (active_scope composition), and ADR-030 (flow_id schema). Internal consistency across `wave-decisions.md` DWD-13, `application-architecture.md`, `c4-diagrams.md`, and `handoff-design-to-distill.md` is strong. The naming convention ratified in DWD-13 is a pattern-teaching win for future flows. One minor documentation gap: the amendment does not explicitly address Redis event-log key-prefix migration (MR-1 to MR-1.5), but this is not a blocker — MR-1.5's scope covers it.

**Critical issues: 0**
**High issues: 0**
**Recommendations: 3 (non-blocking, addressable in MR-1.5 or immediately after)**

---

## What the Amendment Got Right

1. **Clean seam between machines**: project-context owns "Which project am I in?" (org_id + project_id halves of active_scope); session-chat owns "What's happening in my current session?" (resource_* half + chat-emitting states). The carve-up is orthogonal and matches the journey YAML's narrative without distortion.

2. **Correctly rejected three-machine split**: The rationale (session.active_dataset_id is per-session; dataset attachment loops within session_active; premature without a decoupled dataset lifecycle) is sound. Coordination overhead for a 1-state `resource-context` would exceed cohesion benefit.

3. **`project_ready` broadcast hook is idempotent and correct**: Same project_id → no-op (session-chat's `project_id` context already matches). Different project_id → session-chat invalidates session_id + resource_* and re-enters loading_session_list. The re-broadcast on project-switch (project-context: `switching_project → project_selected`) is explicitly articulated. This mirrors the `j001_ready` pattern and respects ADR-028's no-machine-imports rule.

4. **Per-machine error_recoverable correctly rejected orchestrator-level concern**: project-context and session-chat have disjoint cause-tag unions and different retry payloads. Conflating them at the orchestrator would violate ADR-028's "no machine introspection from the orchestrator" invariant. Each machine's `error_recoverable` is correctly typed and isolated.

5. **Pattern convention ratified and teachable**: DWD-13 §"Naming convention" articulates a rule future workers will discover ("One bounded responsibility per state machine; 'and' denotes strict sequence dependency"). The cite path (DWD-13 + ADR-028 §cross-machine signaling + `application-architecture.md` preamble) is clear. This is the amendment's highest-value contribution beyond the immediate J-002 fix.

---

## Blockers

**None.** The amendment is sound and ready for merge.

---

## Recommendations

### R1: Explicitly address Redis event-log key-prefix migration in MR-1.5 scope (non-blocking)

**File / section**: `handoff-design-to-distill.md` §SRP amendment addendum — add a "Migration concerns" subsection.

**Issue**: The amendment states (`application-architecture.md` §1): "TWO new key prefix values: `ui-state:project-context:<principal_id>:events` AND `ui-state:session-chat:<principal_id>:events`." MR-1 already produced events under the old `ui-state:project-and-chat-session-management:<principal_id>:events` key. The amendment does NOT explicitly address how existing Redis event logs are migrated when MR-1.5 splits the key prefix.

**Fix** (one paragraph): Clarify that MR-1.5's refactor is accompanied by a one-time Redis data migration: for each principal in the old prefix, a single XRANGE read → XADD double-write from old key to both new keys (idempotent on re-runs; safe if a principal has no events). Alternatively: lazy-migration on first read (if old key exists, migrate on demand). The choice is MR-1.5's implementation detail; the handoff just needs to name the concern so the DELIVER engineer surfaces it.

**Why non-blocking**: The amendment's architecture is unaffected. The migration is operational hygiene, not architectural.

### R2: Extend the handoff addendum with a note on `waiting_for_project` observability (non-blocking, clarity only)

**File / section**: `handoff-design-to-distill.md` §Harness extensions.

**Issue**: The amendment states (`application-architecture.md` §2): "`waiting_for_project` is purely an internal artifact of the split ... no FE component, no acceptance test, no projection consumer reads `state === "waiting_for_project"`." This is correct but raises a follow-up: what does the FE show while session-chat is in `waiting_for_project`?

**Fix** (one sentence): "During the brief `waiting_for_project` dwell (typically <10 ms between orchestrator broadcast and machine transition), the FE renders from project-context's projection only — no session-list UI appears until session-chat enters `loading_session_list`. The projection-compose layer in `uiStateClient` naturally handles this: if session-chat's projection doesn't exist yet (actor not spawned), the composer defaults session-chat context fields to null." This reassures DISTILL that the harness needs no special `waiting_for_project` assertion path.

**Why non-blocking**: Clarity only. The logic is correct; the documentation gap is minor.

### R3: Call out the `dependency-cruiser` rule scope in ADR-027 §7 (optional)

**File / section**: ADR-027 §7 is out of scope of this MR — note in DWD-13 or a follow-up commit message.

**Issue**: DWD-13 states: "The `dependency-cruiser` rule from ADR-027 §7 already covers this; the rule does not need to change." This statement is **already accurate**: two machines under `machines/` cannot import each other by definition of the rule. The MR-1.5 refactor will mechanically satisfy the rule without any change. No action needed.

**Why optional**: The statement in DWD-13 is correct as written. This is a "verify the auto-extension" note for completeness.

---

## Validation of the Four Questions from Command-Args

### Q1: Seam (project-context / session-chat boundary) — SOUND

The amendment correctly identifies the seam at the project/session lifecycle boundary:

- **project-context owns**: org_id, project_id, project creation/selection/switching, scope mismatch terminal, project-level deep-link intents (intent_project_id).
- **session-chat owns**: session list, session resume, session active, dataset attachment, session-level intents (intent_session_id, intent_resource_*).

**Evidence**: `application-architecture.md` §2.1.A / §2.1.B context shapes are disjoint. The only overlap is `org_id` + `project_id` (duplication for ADR-028 independence; explicitly noted at §2.1.C). The carve-up mirrors the journey YAML's narrative without distortion.

**Verdict**: Q1 PASS.

### Q2: FREEZE/THAW handling — CORRECT

**Per-machine FREEZE handler** (`application-architecture.md` §2.2): Both machines declare top-level `on.FREEZE` with their own `last_live_state` assignment. XState v5's top-level `on` is inherited by all states per US-210 AC. Each machine's `freeze` state declares `on.THAW` with a conditional target derived from `last_live_state`.

**Orchestrator broadcast**: The existing `orchestrator.ts:796-820` loop enumerates spawned actors and broadcasts `FREEZE`/`THAW` to each. The loop is byte-unchanged. Doubling the actor count per principal (from 1 to 2) does not change the loop's semantics.

**Replay buffer**: Per-flow, already keyed by `flow_id`. Doubling the flow count per principal is within the ADR-030 §3 planning-horizon ceiling.

**Verdict**: Q2 PASS.

### Q3: error_recoverable — PER-MACHINE, CORRECT

**Why per-machine (not orchestrator-level)**: DWD-13 rejects orchestrator-level consolidation with three reasons:
1. project-context retries into `creating_project`, `resolving_initial_scope`, `switching_project` with payloads `pending_project_name`, `intent_project_id`.
2. session-chat retries into `loading_session_list`, `resuming_session`, `session_active_no_messages`, `switching_dataset_context` with payloads `pending_first_message`, `intent_session_id`, `intent_resource_id`.
3. Different originating states + different retry payloads. Conflating them would require the orchestrator to know each machine's transition map — violating ADR-028:46-48.

**Each machine's error_recoverable**: Modeled identically (XState v5 idiom: `last_live_state` history-target on `retry_clicked`). Closed cause-tag unions per machine (no overlap between `ProjectContextCauseTag` and `SessionChatCauseTag`).

**Verdict**: Q3 PASS.

### Q4: `switching_dataset_context` home — SESSION-CHAT, CORRECT

**Why session-chat (not a third `resource-context` machine)**: DWD-13 rejects three-machine split with three reasons:
1. In J-002 scope, dataset attachment is **per-session** (DWD-2: `session.active_dataset_id` is a column on the `sessions` row). Dataset has no lifecycle without a session.
2. `switching_dataset_context` always runs from `session_active` and returns to `session_active`. The state's natural home is the lifecycle it loops inside.
3. A standalone 1-state `resource-context` would need coordination with session-chat on every transition. The overhead exceeds the cohesion benefit.

**Verdict**: Q4 PASS.

---

## Cross-Document Consistency Check

All consistency checks PASS. Notable cross-references:

| Document | Section | Claim | Consistency check |
|---|---|---|---|
| `wave-decisions.md` | DWD-13 decision table | Two machines: project-context (8 states) + session-chat (9 states) | `application-architecture.md` §2.1.A/B lists states identically; `c4-diagrams.md` §2 component names match — ✓ CONSISTENT |
| `wave-decisions.md` | DWD-13 coordination contract | `project_ready` event from project-context→project_selected to session-chat with `{org_id, project_id, project_name, correlation_id}` | `application-architecture.md` §3.2; handoff addendum notes the event also carries `intent_session_id`/`intent_resource_*` — ✓ CONSISTENT (handoff addendum is more detailed) |
| `application-architecture.md` | §2.1.C context carve-up | `org_id` + `project_id` are duplicated for ADR-028 independence | handoff addendum harness extensions describe `assert_scope` composing from both projections — ✓ CONSISTENT |
| `c4-diagrams.md` | §2 orchestrator component | MachineRegistry now has 3 entries | `wave-decisions.md` DWD-8 + `application-architecture.md` §1 — ✓ CONSISTENT |
| `handoff-design-to-distill.md` | Scenario-to-machine table IC-J002-4 | "Atomicity is a cross-machine property" | `application-architecture.md` §0 TL;DR note 6 retires the North Star via two-machine composition — ✓ CONSISTENT |

**Verdict**: Cross-document consistency is strong. No contradictions detected. The handoff addendum is slightly more detailed than the DESIGN amendment in places (e.g., `project_ready` payload extension with intent fields), but this is appropriate detail-level for the next wave.

---

## ADR Fidelity Check

### ADR-028 (XState v5 Actor Model) — HONORED

- **No machine-to-machine imports** (46-48): project-context never imports session-chat; both communicate via orchestrator broadcast only.
- **Orchestrator mediation**: Coordination via `j001_ready` (existing) + `project_ready` (new) hooks, not imperative `send()` calls.
- **MachineRegistry**: Scales cleanly from 1 to 3 entries.

**Verdict**: ADR-028 fidelity is perfect.

### ADR-029 (`active_scope` Propagation Contract) — HONORED

- **Single source of truth**: `active_scope` is composed from BOTH machines' projections by the FE's `uiStateClient.activeScopeHeader`. project-context contributes `{org_id, project_id}`; session-chat contributes `{resource_type, resource_id}`.
- **Agent integration**: The agent reads ONE composed `X-Active-Scope` header — the J-002 split is invisible to the agent.
- **Multi-tenant safety**: ScopeResolver is byte-unchanged; called by project-context (invariants 1, 4) and session-chat (invariants 1, 3, 4).
- **TS harness symmetry**: `harness.j002.assert_scope` reads the composed view.

**Verdict**: ADR-029 fidelity is perfect.

### ADR-030 (UI-State Tier Topology and Scaling) — HONORED AND AMPLIFIED

- **`flow_id` schema** (§6): `flow_id = {machine-name}:{principal_id}`. Two machines → two flows → two Redis key prefixes. Per ADR-030 §6.
- **Scaling ceiling** (§3): Per-principal flow count doubles from 1 to 2 (or 3 counting J-001). Back-of-envelope (ADR-030 system-architecture.md §0: 2-3 orders of magnitude headroom) easily absorbs the increase. No ceiling trigger fires.
- **Single-replica decision** (§2): Unchanged. Both J-002 machines live in the same ui-state container.

**Verdict**: ADR-030 fidelity is perfect. The amendment is a sublinear load increase within the existing capacity envelope.

---

## Edge Cases the Amendment Should Explicitly Address or Defer

### E1: Deep-link forwarding of intents (project-context → session-chat) — ADDRESSED

The amendment explicitly forwards `{intent_session_id, intent_resource_id, intent_resource_type}` via the `project_ready` payload (DWD-13 + `application-architecture.md` §3.4). session-chat consumes them when transitioning out of `waiting_for_project` (e.g., deep-link to `/chat/:channelId` lands in `resuming_session`). The harness and FE compose the intents into the route navigation.

**Verdict**: The amendment is sound. Mechanism is named; explicit state-routing table is appropriate DELIVER detail, not DESIGN.

### E2: `waiting_for_project` vs `no_projects_empty_state` bifurcation — ADDRESSED

The orchestrator's `project_ready` broadcast hook fires only on `project_selected` entry. If project-context stays in `no_projects_empty_state`, session-chat is never spawned. Later, the user creates a project → `project_ready` broadcasts → session-chat spawns and processes it. The idempotency rule (DWD-13: same project_id → no-op; different project_id → invalidate) handles all transitions through the no-projects state.

**Verdict**: The amendment is sound. The orchestrator hook's re-entry semantics are correctly described.

### E3: Token expiry during `switching_project` transition — ADDRESSED

The amendment delegates this to DWD-7's stale-intent guard logic. If a `switching_project_intent` is replayed after THAW, the guard checks if the new project_id is still accessible. The behavior is consistent with other mid-mutation FREEZE scenarios (US-210).

**Verdict**: Covered.

### E4: Projection read during actor spawn — DELIVER SCOPE

Edge case: FE loader fetches both projections concurrently; session-chat actor may not exist yet. The amendment's RD13-2 acknowledges fan-out cost but does not explicitly say what happens if session-chat doesn't exist yet.

**Clarification needed** (non-blocking; DELIVER scope): The `uiStateClient` composer should return a default empty session-chat projection if the actor doesn't exist (e.g., during cold sign-in before `project_ready` fires). This is a standard pattern for optional projections. The amendment's scope is architecture, not implementation detail.

**Verdict**: Not an amendment gap; a DELIVER implementation concern.

---

## Summary

The amendment is **architecturally sound**, **internally consistent**, **ADR-compliant**, and ready for merge. It directly executes the SRP review's proposed split without introducing new risks. The naming convention (DWD-13) is a valuable teaching artifact for future flows. Three non-blocking recommendations address documentation clarity and operational hygiene (Redis migration, `waiting_for_project` observability, dependency-cruiser rule note).

The amendment respects the Iron Rule: it does not modify the 10 user stories' acceptance criteria; no acceptance test needs to change (per handoff addendum, all 65 scenarios remain valid). The journey YAML's 14-state contract is preserved; the split is implementation-layer only.

**Status**: APPROVED. Three non-blocking recommendations can be applied in-place (R1 + R2 — small handoff addendum extensions) or deferred to MR-1.5 (R3 — no action needed).

---

## References

- `docs/feature/project-and-chat-session-management/design/wave-decisions.md` (DWD-13)
- `docs/feature/project-and-chat-session-management/design/application-architecture.md` (preamble + §0–§3, §6–§9, §13)
- `docs/feature/project-and-chat-session-management/design/c4-diagrams.md` (§1–§3)
- `docs/feature/project-and-chat-session-management/design/handoff-design-to-distill.md` (SRP amendment addendum)
- `docs/feature/project-and-chat-session-management/design/review-by-software-crafter-srp.md` (binding input)
- `docs/decisions/adr-028-xstate-v5-actor-model.md`
- `docs/decisions/adr-029-active-scope-propagation-contract.md`
- `docs/decisions/adr-030-flow-state-topology-and-scaling.md`
