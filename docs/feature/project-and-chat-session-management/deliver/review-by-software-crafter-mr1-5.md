# Software-Crafter Review — MR-1.5 J-002 Machine Split

**Reviewer**: nw-software-crafter-reviewer (dispatched 2026-05-13)
**Branch**: `refactor/j002-machine-split-in-place`
**Files reviewed**: working tree (uncommitted), all new + modified files under `ui-state/lib/machines/` and `ui-state/lib/orchestrator.ts` + `ui-state/index.ts`
**Review angle**: RPP L3 (Responsibilities) — does the split execute the SRP review's mandate without behavior change?

---

## TL;DR

**APPROVED** — The J-002 machine split is architecturally sound, SRP-compliant, and ADR-028-compliant. All moving parts are wired correctly, tests are cohesive, and the REC-2 wire-protocol decision is well-justified.

| Gate | Status | Evidence |
|------|--------|----------|
| SRP Integrity | PASS | project-context owns "Which project?"; session-chat owns "What's happening?". Seam orthogonal; matches DESIGN §2A/§2B. |
| ADR-028 Compliance | PASS | No cross-machine imports. Orchestrator mediates via `j001_ready` + `project_ready` broadcast hooks. |
| `project_ready` broadcast hook | PASS | Idempotent; fires on initial spawn (orchestrator.ts beginIfNotStarted post-settle) and post-event re-entry (send-path `project_selected` branch). Same project_id → no-op; different → context update. |
| Type discipline | PASS | ProjectContextMachineContext / SessionChatMachineContext disjoint except for intentional `intent_*` duplication (§3.4) and `org_id`/`project_id` necessary for actor independence. |
| MR-1.5 stub discipline | PASS | session-chat declares `waiting_for_project` only; reserves future state names. `project_ready` assigns context without transition target (MR-2 lifts). No scope creep. |
| Iron Rule honored | PASS | Zero acceptance-test body modifications. 9 lifted behaviors (B1–B9) keep identical assertions; type-rename only. |
| CM-A (no internal-import leaks) | PASS | `tests/acceptance/project-and-chat-session-management/` imports `driver.HTTPProbe` + `J002Driver` only; no `from ui-state/lib`. |
| Wire-protocol stability (REC-2) | PASS | URL prefix + Redis key + flow_id stay `project-and-chat-session-management`. Decision documented at orchestrator.ts:41–62 and PROJECT_CONTEXT_WIRE_NAME constant. |

**Critical issues**: 0  •  **High issues**: 0  •  **Non-blocking recommendations**: 3

---

## What the Split Got Right

1. **Clean responsibility carve-up.** project-context's 6 live states (resolving_initial_scope → no_projects_empty_state | creating_project → project_selected → scope_mismatch_terminal | error_recoverable) own scope resolution + project mutation. session-chat's stub (`waiting_for_project` only in MR-1.5; 8 reserved type-level states for future MRs) owns session lifecycle. Narratives are orthogonal.
2. **Explicit cross-machine contract.** The `project_ready` event type declares all forwarded fields explicitly at `SessionChatEvent` (session-chat.ts:114-123). The orchestrator's `maybeFireProjectReady` private method is resilient (try/catch on the spawn) and guards against null org_id/project_id.
3. **Idempotency-first design.** session-chat's `project_ready` handler (`session-chat.ts:191-207`) assigns context fields with `reenter: false` so re-emission of the same project_id is a safe no-op. MR-2 inherits this property when adding the transition target.
4. **ADR-028 pattern teaching.** The naming convention DWD-13 ratified ("One bounded responsibility per machine; 'and' denotes strict sequence dependency") is now visible in code. Future MR crafters will discover the rule clearly.
5. **Test integrity preserved.** `project-context.test.ts` (B1–B9, lifted verbatim) and `session-chat.test.ts` (S1–S3 stub) are port-to-port at the XState actor boundary. No internal-class testing.
6. **Orchestrator responsibility scoping.** `beginIfNotStarted` dispatches the appropriate event shape based on machine type. `maybeFireProjectReady` is called from TWO sites — initial-spawn settle AND post-event re-entry in `send()` — covering both the initial scope resolution AND future project-switch paths (MR-4).

---

## Blockers

**None.** All critical gates PASS.

---

## ADR Fidelity Check

**ADR-028 (XState v5 Actor Model)**
- ✓ No machine-to-machine imports. `project-context.ts` imports only `active-scope`; `session-chat.ts` imports only `active-scope`.
- ✓ Orchestrator mediation — all cross-machine signaling via `beginIfNotStarted` + broadcast hooks `j001_ready` + `project_ready`.
- ✓ MachineRegistry strategy table extends cleanly to 3 entries with no if/else chaining.

**ADR-029 (`active_scope` Propagation Contract)**
- ✓ Single source of truth composition: project-context provides `{org_id, project_id}`; session-chat provides `{resource_type, resource_id}`.
- ✓ Agent sees ONE composed `X-Active-Scope` header; machine split is invisible to the agent.

**ADR-030 (UI-State Topology)**
- ✓ `flow_id = {machine-name}:{principal_id}` schema. project-context uses wire name `project-and-chat-session-management`; session-chat uses `session-chat`.
- ✓ Per-principal flow count goes 1 → 2; comfortably within ADR-030 §3 planning-horizon ceiling.

---

## REC-2 Verdict (Wire-Protocol Back-Compat Decision)

**SOUND AND JUSTIFIED.** The decision to preserve `project-and-chat-session-management` as the wire-protocol machine name while splitting the source tree is pragmatic and reversible:

| Concern | Assessment |
|---|---|
| Acceptance test stability | PASS — All 16 J-002 scenario drivers hardcode `/flow/project-and-chat-session-management/*` URLs. Zero test modification required. |
| Revert path | CLEAR — Future MRs can drop the legacy wire name. DISTILL scenarios (immutable) do NOT change. |
| Internal clarity | GOOD — Comments at `orchestrator.ts:41-62` explicitly explain the alias decision and cite DWD-13 + REC-2. |
| session-chat isolation | PASS — `SESSION_CHAT_WIRE_NAME = "session-chat"`. No aliasing needed because no existing scenario references it; MR-2 lands new scenarios with the new wire name. |
| Code clarity risk | MINIMAL — Future maintainer reading the code will see comments explaining the decision. |

The decision is documented in commit body, code comments, and `upstream-issues.md`.

---

## SRP + Seam Validation

**Seam location (project-context ↔ session-chat boundary)**:
- project-context handles: org selection (J-001 down), project resolution (backend call), project creation, project switching (MR-4), cross-tenant terminal, deep-link routing entry.
- session-chat handles: session list, session resume, message transcript, dataset attachment, chat turns, session-level deep-link intents.

**Orthogonality check** (RPP L3 divergent-change vectors):
- New AC for "dataset auto-switch on AI recommendation" → ONLY session-chat changes.
- New AC for "multi-project browse" → ONLY project-context changes.
- New AC for "org-scoped settings" → ONLY J-001 changes.

No shotgun surgery risk. PASS.

---

## Cross-Document Consistency

Checked against `application-architecture.md` §2A + §2B + §3 and `wave-decisions.md` DWD-13:

| Reference | Check |
|---|---|
| Context shapes (§2.1.A/B disjoint) | ProjectContextMachineContext vs SessionChatMachineContext verified separate except for intentional `intent_*` + `org_id`/`project_id` per §3.4. |
| State counts | project-context: 6 live + error_recoverable; type declares 8 (future freeze). session-chat: 1 live + 7 reserved at type level. Matches DESIGN §2.4. |
| `project_ready` payload | Declared at SessionChatEvent (session-chat.ts:114-123); forwarded by orchestrator at `maybeFireProjectReady`. Matches DWD-13 §3.2.B. |
| Per-machine error_recoverable | ProjectContextCauseTag (project-context.ts:47-53) vs SessionChatCauseTag (session-chat.ts:56-62) — disjoint cause unions. Matches DESIGN. |
| FREEZE/THAW handling | Orchestrator broadcast loop byte-unchanged; doubling actor count per principal absorbed within scaling envelope. MR-6 will add the top-level `on.FREEZE` handler to each machine. |

---

## Test Quality

**project-context.test.ts** (9 behaviors): All assertions on observable outcomes (state value + context fields), no internal XState wiring. `waitFor` polls on snapshot transitions with 5s timeout — no flaky timing patterns.

**session-chat.test.ts** (3 stub behaviors): S1 verifies initial state + empty context; S2 verifies `project_ready` assigns org/project/correlation; S3 verifies intent_* forwarding. All public-surface assertions. MR-2's crafter inherits a working harness.

**Acceptance test integrity**: 16/18 MR-1 scenarios pass against the split. 2 failures (`test_us204_*::test_cold_deep_link_*`, `…::test_deep_link_with_intent_resource_*`) reproduce IDENTICALLY on `main` (b20bbd2 baseline) — pre-existing web-ssr SSR-rendering issue unrelated to the split. Documented in `upstream-issues.md`.

---

## Non-Blocking Recommendations

### R1 — MR-2 spotlight: lift the `project_ready` transition target

The session-chat stub's `project_ready` handler stays in `waiting_for_project`. MR-2 MUST update the handler to:

```ts
project_ready: {
  target: context.intent_session_id ? "resuming_session" : "loading_session_list",
  …
}
```

Code comment at session-chat.ts:186-190 already names this; the handoff should add a spotlight so MR-2's crafter doesn't accidentally keep the self-loop.

### R2 — `intent_*` lifecycle in MR-2+

The `intent_*` duplication between project-context and session-chat (per DESIGN §3.4) is intentional and correct. MR-2+ MUST ensure:
1. When session-chat consumes `intent_session_id`, clear it after routing to `resuming_session` (so stale deep-links don't resurface on re-entry).
2. The orchestrator's `maybeFireProjectReady` always includes the current values so re-broadcasts pick up the latest intent state.

MR-2's crafter should add a DONE assertion in the stub's test to verify intent_* are populated and ready for handoff.

### R3 — Forward-compatible URL-family migration

When MR-2's acceptance scenarios introduce the `/ui-state/flow/session-chat/*` URL family (per DESIGN §1 aspiration), the migration is mechanical:
1. The MACHINE_REGISTRY entry for `session-chat` is already present (orchestrator.ts).
2. The HTTP route handlers are parameterized by `:machine`, so the new URL family works automatically.
3. MR-1.5 acceptance tests continue via `project-and-chat-session-management` (no change).
4. MR-2+ tests can drive `session-chat` directly if testing session-only flows.

This is forward-compatible as-is; no action needed in MR-1.5.

---

## Quality-Gate Validation (DES discipline)

| Gate | Status | Evidence |
|------|--------|----------|
| G1: Acceptance test isolation | PASS | One J002Harness invocation per scenario; no test pollution. |
| G2: Test entry points | PASS | Tests enter via `driver.HTTPProbe` (public HTTP) and `J002Harness` (public TS interface), never `from ui-state/lib`. |
| G4: No internal class mocks | PASS | Tests mock only actor dependencies (resolveInitialScope, createProject) via `fromPromise` stubs at machine construction; XState actor is real. |
| G5: Business language | PASS | "settles in no_projects_empty_state when resolveInitialScope returns empty"; "spawns into waiting_for_project with empty context". |
| G6: 100% GREEN | PASS-equivalent | 64/64 ui-state tests; 16/18 acceptance (2 pre-existing web-ssr failures reproduce on main; documented). |
| G7: Test budget | PASS | 9 + 3 = 12 distinct behaviors; budget 24 (2× behaviors). |
| G8: Port-to-port testing | PASS | All unit tests call `createActor()` on the real machine and assert on `actor.getSnapshot()` state/context. |
| G9: No test modification | PASS | project-context.test.ts B1–B9 IDENTICAL assertions; session-chat.test.ts NEW only. Zero weakened/deleted/skipped tests. |

---

## RPP L3 Code Smell Scan

- **Responsibilities**: Each machine has a single cohesive responsibility with no divergent change vectors. PASS.
- **Abstractions**: No premature generalization. MACHINE_REGISTRY is a classic strategy table (one entry = one machine; adding J-003 is one new line). PASS.
- **Dependencies**: Both machines depend on `active-scope.ts` (public contract); no internal coupling. PASS.

**Verdict**: L1–L3 clean. No smells detected.

---

## External Validity Check

**Question**: If I follow the acceptance test entry points, will the feature WORK (not just EXIST)?

**Answer**: YES.

- Tests import via `driver.HTTPProbe` (public HTTP) and `J002Harness` (public TS interface from `tests/acceptance/user-flow-state-machines/harness/user-flow-harness.ts`).
- Both harness entry points call the orchestrator's `begin()` and `send()` methods.
- Orchestrator is wired in `ui-state/index.ts` and started by `wireRoutes()`.
- The compose stack includes the ui-state container; it is part of the functional system.
- 64/64 unit tests + 16/18 acceptance scenarios passing. The 2 failures are pre-existing web-ssr issues per `upstream-issues.md`.

The feature is FULLY INTEGRATED and wired to work end-to-end.

---

## Status

**APPROVED for merge.** Ready for MR-1.5 commit + push + `gt mq submit`.

---

## References

- DESIGN amendment: `docs/feature/project-and-chat-session-management/design/application-architecture.md` (§2A + §2B + §3)
- Binding decisions: `docs/feature/project-and-chat-session-management/design/wave-decisions.md` (DWD-13)
- SRP review (driver): `docs/feature/project-and-chat-session-management/design/review-by-software-crafter-srp.md`
- DESIGN amendment review: `docs/feature/project-and-chat-session-management/design/review-by-solution-architect-srp-amendment.md`
- ADR-028 (XState v5 Actor Model), ADR-029 (active_scope Propagation), ADR-030 (UI-State Topology)
- Upstream issues (pre-existing): `docs/feature/project-and-chat-session-management/deliver/upstream-issues.md`
