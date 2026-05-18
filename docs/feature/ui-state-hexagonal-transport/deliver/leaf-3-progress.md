# DELIVER progress — ui-state hexagonal-transport (ADR-040 LEAF-series)

LEAF-3 record. Mirrors `leaf-1-progress.md` / `leaf-2-progress.md`.
LEAF-4..6 remain DISTILL-deferred (skip-marked specs); do not alter them.
LEAF-1/LEAF-2's records are unchanged.

| LEAF | Status | Wave | Source commits | Behavior |
|---|---|---|---|---|
| LEAF-1 | ✅ delivered | DELIVER (2026-05-16) | `4c33709` | behavior-neutral (A/B proven) |
| LEAF-2 | ✅ delivered | DELIVER (2026-05-16) | `7a73cf4` | behavior-neutral (A/B Δ=0) |
| LEAF-3 | ✅ delivered | DELIVER (2026-05-18) | MR-L3a `11d817b` → MR-L3b `9ac0a55` → **MR-L3c N12–N18** | behavior-neutral (A/B Δ=0) |
| LEAF-4 | ⏳ deferred | — | — | behavior-neutral |
| LEAF-5 | ⏳ deferred | — | — | behavior-changing (equivalence gate) |
| LEAF-6 | ⏳ deferred | — | — | behavior-neutral |

## LEAF-3 — orchestrator decomposed into a generic pump + three FlowStrategies

**Binding source:** ADR-040 §D1 (orchestrator decomposed into a thin
generic pump + per-machine strategies — decomposition of the existing
class, not a parallel subsystem), §D2 (the generic pump KEEPS:
actor-system ownership & spawn lifecycle, the FREEZE/THAW broadcast LOOP,
the bounded intent-replay buffer, the FE projection-read endpoint; the
FlowStrategy owns machine definition / begin / event→transition /
settle), ADR-040 LEAF-3 ("settle→emit still writes the event-log —
behavior-neutral"), ADR-030 §"Projection as primary read model" + LEAF-D
(the no-orchestrator-snapshot-reads ESLint rule must still pass on the
shrunk orchestrator.ts), ADR-028 ("no machine imports another machine";
the orchestrator stays the SOLE cross-machine mediator — the
`project_ready`/`auth_ready` spawn-event ROUTING is that role and stays
pump-central, §3). Spec:
`ui-state/lib/hexagonal-transport/leaf-3-orchestrator-pump-carve.test.ts`.

MR-L3a carved `LoginOrgSetupStrategy` (login `beginDirect`/`settle`);
MR-L3b carved `ProjectContextStrategy`
(`settleSpawn`/`applyEvent`/`settle`/`applyDeepLink`/`settleFreeze`/
`settleThaw`). **MR-L3c (this record, N12–N18)** carved
`SessionChatStrategy` and performed the residual-pump cleanup that proves
the orchestrator is a generic pump.

### Mikado nodes (one atomic commit per node)

| Node | Commit | What |
|---|---|---|
| N12 | `0f82488` | `SessionChatStrategy.settleSpawn` — carve the private `emitSessionChatSpawnEvents` + `appendSessionChatTerminalEvents` helper + extend `harvestSettledSessionChatState` to surface the already-present `org_id`/`project` (sanctioned AMB-1 boundary; byte-identical to the pre-carve `spawn.*` input on the spawn path). Both `beginIfNotStarted` call sites rewired; the dead private removed. |
| N13 | `d3a957d` | `SessionChatStrategy.applyEvent` — carve the `switching_dataset_context_started` pre-settle (US-209). Kept inside the `machine===` wrapper for N17: the SSE projection-stream test is await-count-coupled at the pre-settle point — an extra unconditional `applyEvent` await split the SSE 2nd frame before `ready`. |
| N14 | `ea8fbad` | `SessionChatStrategy.settle` — carve the post-settle terminal block (`dataset_attached`/`dataset_access_denied`; `session_resume_not_found`; default `appendSessionChatTerminalEvents`). |
| N15 | `a933270` | `SessionChatStrategy.settleFreeze/settleThaw` — carve the `broadcastFreeze` `session_chat_frozen` tail (loop now resolved-strategy dispatched) + the `broadcastThaw` history-target re-entry tail. The FREEZE/THAW broadcast LOOP stays central (§3/AMB-3). The now-dead private `appendSessionChatTerminalEvents` removed. |
| N16 | `c16095f` | VERIFY-SESSION barrier — controlled A/B `mr_3`/`mr_5`/`mr_6` FAILED-set Δ=0 + vitest Δ=0 + eslint 0 incl LEAF-D, before the N17 cleanup. |
| N17 | `97d1412` | **GOAL-defining residual-pump cleanup.** `send()`: collapse N7's unconditional `projectContextStrategy.applyEvent` + N13's `machine===` wrapper into ONE `FLOW_STRATEGY_REGISTRY.resolve(input.machine).applyEvent` dispatch (per-machine-exclusive; exactly one await = baseline SSE timing). settle chain stays unconditional-by-ref (login→hook→project→hook→session — NOT per-machine-exclusive per the N3 precedent; guards inside strategies). `beginIfNotStarted()`: retire the N12 wrapper + `!==PROJECT_CONTEXT` early-return + N6 project block → one resolved `strategy.settleSpawn` + STATE-gated pump-central `maybeFireProjectReady`; `isProjectReadyDispatch`/`isAuthReadyDispatch` cross-machine spawn-event ROUTING stays pump-central (ADR-028 sole-mediator). Un-skip the leaf-3 spec; implement all 5 `it` blocks GREEN UNWEAKENED. |
| N18 | _this commit_ | FULL RG-LEAF final gate + this record. |

### GOAL: zero `machine===` in pump dispatch — **achieved**

`begin` / `beginIfNotStarted` / `send` / `appendDeepLinkEvents` contain
ZERO per-machine `machine === "<wire>"` transition-dispatch branch. All
per-machine logic is reached purely via
`FLOW_STRATEGY_REGISTRY.resolve(input.machine)` + the typed FlowStrategy
port member (or the unconditional-by-ref settle chain whose guards are
INSIDE each strategy — the N3/N8 precedent for the non-machine-exclusive
chain). The ONLY residual wire-name comparison in the pump is the
`isProjectReadyDispatch`/`isAuthReadyDispatch` cross-machine spawn-event
ROUTING — ADR-028's sole-cross-machine-mediator role that ADR-040 §D2 /
leaf-3-plan §3 explicitly KEEP pump-central (it routes WHICH spawn event
the mediator forwards, not which strategy's transition emission runs).
The un-skipped leaf-3 spec it#1 pins this structurally and is
sensitivity-verified (injecting a fake `machine===` into `send()` fails
it).

### Final shape

- `ui-state/lib/orchestrator.ts`: **2034 → 1689 lines** (−345; the
  carved-out `emitSessionChatSpawnEvents` + `appendSessionChatTerminalEvents`
  privates removed, dispatch generalized).
- Three FlowStrategy files at `ui-state/lib/machines/<machine>/strategy.ts`:
  - `login-and-org-setup/strategy.ts` (415 L, MR-L3a)
  - `project-context/strategy.ts` (684 L, MR-L3b)
  - `session-chat/strategy.ts` (667 L, **MR-L3c**)

### LEAF-5 NOT pulled forward (scope-fence honored)

The entire `harvestSettled*` family is intact and CALLED by the
strategies (`harvestSettledSessionChatState` was *extended* to surface
already-present `org_id`/`project`, never deleted/inlined).
`settle→emit` STILL appends to the Redis-Streams FlowEventLog;
`projectionFor` STILL resolves via `buildProjection(eventLog.read())`
(read-then-build). No SettledStateStore swap, no buildProjection
event-log-path removal, no alias-map removal. The leaf-3 spec it#3 pins
this. No `tests/acceptance/**` or leaf-{1,2,4,5,6} spec modified.

### RG-LEAF — controlled A/B (this crew host, same run)

Agent overseer-maintained & IDENTICAL for A and B (never touched — this
MR changes ZERO agent code); only the ui-state container rebuilt between
runs. A = pristine `9ac0a55`; B = branch HEAD `97d1412`.

| Marker | A (`9ac0a55`) | B (`97d1412`) | FAILED-set Δ |
|---|---|---|---|
| mr_1 | 18 passed, 0 failed | 18 passed, 0 failed | **EMPTY (Δ=0)** |
| mr_2 | 12 passed, 0 failed | 12 passed, 0 failed | **EMPTY (Δ=0)** |
| mr_3 | 6 passed, 0 failed | 6 passed, 0 failed | **EMPTY (Δ=0)** |
| mr_4 | 14 passed, 0 failed | 14 passed, 0 failed | **EMPTY (Δ=0)** |
| mr_5 | 7 passed, 0 failed | 7 passed, 0 failed | **EMPTY (Δ=0)** |
| mr_6 | 8 passed, 0 failed | 8 passed, 0 failed | **EMPTY (Δ=0)** |

Identical pass/fail node-id set on every marker → **MR-L3c introduces
ZERO behavioral delta**. (This crew host was healthy — A is fully green,
matching the J-002 FINALIZE baseline; the binding gate is per-run Δ=0.)

- `cd ui-state && npx vitest run` → **164 passed | 31 skipped** (159
  pre-existing all green = 0 regressions vs `9ac0a55`'s 159; +5 = the
  deliberately un-skipped leaf-3 spec, GREEN — the documented leaf-2
  un-skip precedent pattern). Deterministic across repeated runs.
- `cd ui-state && npx eslint .` → **0 errors** (exit 0; LEAF-D
  `no-orchestrator-snapshot-reads` still passes on the shrunk
  orchestrator.ts — the carve introduced no `getSnapshot().context`
  read; only pre-existing repo-wide `intent-prefix` warnings, none in
  the changed code).
- `python3 tools/check_workspace_consistency.py` → ✓ (exit 0).
- `./tools/test/test.sh --auto` → ui-state subtree → `npx vitest run`
  green.

**Out of scope (scope fence honored):** intent-buffer / FREEZE-THAW
broadcaster stay pump-internal (LEAF-4); SettledStateStore swap +
buildProjection event-log-path removal + `harvestSettled*` deletion NOT
pulled forward (LEAF-5); no alias removed (LEAF-6).
