# ADR-044: ChatApp Coordinator Supersedes FlowOrchestrator; Persistence Moves to Hybrid Snapshot + Audit-Log

**Status:** Accepted (direction ratified by user 2026-05-25; built inside-out — Phase 1 landed, Phases 2–4 sequenced below)
**Date:** 2026-05-25
**Originating wave:** DESIGN — interactive architecture review of the `ui-state` flow-coordination substrate (review carried at `docs/feature/chat-app-machine/design/chatapp-coordinator-review.md`)
**Author:** Zach Allen (interactive design review; Hera nw-ddd-architect review, Propose mode)

**Relationship to prior ADRs:**
- **Fires the ADR-030 2026-05-16 "emission-completeness tripwire."** That amendment pre-committed a trigger: *when the cost of hand-policing "every machine settle must emit a FlowEvent" justifies building compile-time enforcement, instead evaluate replacing the event-sourced projection with a simpler server-authoritative store.* The ChatApp pivot is that moment — the coordinator makes the live actor the state-of-record, so the manufactured invariant ceases to be load-bearing. See §3.
- **Is the first faithful implementation of ADR-028** (XState v5 actor model: "one root orchestrator actor per process; cross-machine signaling via the actor system"). Today the orchestrator is a *class*, not an actor, and signaling is a hand-rolled `for…of actors` loop — a latent ADR-028 drift. ChatApp closes it; it does **not** open a new actor-model decision. The children already pass ADR-028's discriminating test and are **kept**.
- **Preserves ADR-027** (the per-`flow_id` `FlowProjection` wire contract). The internal persistence unit may become "one ChatApp record," but the external `GET /flow/{machine}/projection` envelope stays **byte-stable as a derived view** until a separately-sequenced FE + auth-proxy ripple retires the per-machine read paths. This is the make-or-break external constraint (§2).
- **Supersedes the coordination role of the FlowOrchestrator** (`lib/orchestrator.ts`, `orchestrator-harvester.ts`, `wait-for-settled-state.ts`, `FlowActorRegistry`, `FrozenState`, the strategies' settle/emission bodies). They are deleted **last** (Phase 4), only once ChatApp provably subsumes all four of their responsibilities against a characterization net.
- **Reconciliation point with ADR-043** (retire ui-state token-lifecycle modeling). ADR-043 retired the *children's* per-machine freeze/thaw broadcast + silent-reauth on the premise that auth-proxy (ADR-016) owns the token lifecycle. ChatApp models a parent-level `connectivity` region as the structurally-correct home for any residual freeze/reauth semantics (review §2, R4: a future backend-401 boundary). **This ADR does not re-ratify a live freeze path.** Phase 1 builds the region injectable + fakeable + standalone; whether ChatApp ultimately *wires* it (vs. leaving it inert per ADR-043) is deferred to when boundaries land (Phase 4) and remains governed by ADR-043's logic. See §5.

---

## Context

The "three independent machines + a `FlowOrchestrator`" model is, on inspection, a **parent
coordinator implemented imperatively in plain TS**. Everything a parent statechart would own is
present in `FlowOrchestrator`, hand-rolled:

| Parent-coordinator concern | Where it lives today |
|---|---|
| Child lifecycle / spawn | `beginIfNotStartedCore`, `FlowActorRegistry` |
| Hand-off auth → project | `settle()` returns `authReady` → pump `beginIfNotStarted(project-context)` |
| Hand-off project → chat | `maybeFireProjectReady` |
| Cross-machine freeze | `broadcastFreezeCore` / `broadcastThawCore` + per-flow `FrozenState` buffer |
| Replay buffer | `FrozenState.queued` + two-pass `replaySeq` THAW |
| Terminal emission | `dispatchAndSettle` 3-strategy settle chain |
| Projection resolution | `projectionFor` → `buildProjection` event-log fold |

The accidental complexity concentrates here: a hand-rolled cross-machine settle-chain, a
freeze/thaw broadcast, a flat actor registry, ~7 sanctioned-snapshot harvest sites, and — the
costliest — a **manufactured, hand-policed emission invariant** (every settle must emit a
FlowEvent or the projection silently goes stale; three recurrences cited in ADR-030's
2026-05-16 amendment).

The children are **healthy**: their context is internal handler state, contracts flow via
`event.output` / the projection, and no child references another (ADR-028). The orchestrator —
not the children — is the thing to replace.

---

## Decision

### 1. A `ChatApp` parent coordinator machine (XState v5)

`ChatApp` is a top-level **parallel** machine with two orthogonal regions:

- **`lifecycle`** — the forward cycle `onboarding → project_context → chat` (+ `rejected`).
  The children are **invoked** (not spawned), phase-scoped. Project-context is invoked on an
  ancestor (`engaged`) of both `project_context` and `chat`, so it survives into chat to serve
  project switches; session-chat is invoked on `chat` only.
- **`connectivity`** — the freeze overlay `live ⇄ frozen`, orthogonal to lifecycle, so a freeze
  pauses intent-forwarding *in place* in any phase. This replaces `broadcastFreezeCore`'s
  mark-then-loop and the per-flow `FrozenState` map with a single parent region + a
  parent-held buffer (`context.held_events`).

**Coordination keeps children parent-ignorant (ADR-028):** the parent **watches** each child via
`onSnapshot` and advances on the child's own state value; the `authReady → spawn` /
`projectReady → spawn` pump callbacks become parent transitions + `entry: sendTo(nextChild, …)`
hand-offs. `systemId` is the parent's identity for observability / snapshot-stability, **not**
child-to-child messaging.

> **Correction (2026-05-29):** the `systemId` rationale above is factually wrong. In XState v5
> `sendTo(child, …)` resolves its target through `snapshot.children[id]` and `getPersistedSnapshot()`
> keys invoked-child snapshots by **`id`** — so the parent's own sendTo, observability, and
> snapshot-identity stability are all the **`id`** handle, never `systemId`. `systemId` only
> registers an actor for cross-hierarchy `system.get(systemId)` lookup, which this design never
> uses. The three children had `systemId` set equal to their `id`, making it redundant-but-harmless;
> it was removed in `refactor/remove-redundant-systemid`. (Original text retained above for the record.)

**Children are dependency-injected** through `setup({ actors })` + `machine.provide({ actors })`,
so the implementation is swappable: Phase 1 provides FAKES; Phase 2 provides the real machines.

### 2. Persistence direction: HYBRID, with the projection contract preserved as a derived view

- **Internal hot-state** = XState v5 `getPersistedSnapshot()` of the ChatApp actor (parent +
  invoked children) for restart recovery. The live actor becomes the **state-of-record**.
- **The append-only event log is RETAINED but DEMOTED** from "rebuild-the-actor mechanism" to
  "projection source + audit + SSE substrate." A missed append only delays an SSE push; it no
  longer sticks the state (the actor is the truth).
- **The external `GET /flow/{machine}/projection` envelope stays byte-stable** (`flow_id`,
  `state`, `context`, `active_scope`, `sequence_id`, `last_event_at`, `request_id`) — derived
  from the corresponding ChatApp child slice. `flow_id` is synthesized server-side as
  `{machine}:{principal}` (it always was), and the legacy alias names
  (`login-and-org-setup` → onboarding, `project-and-chat-session-management` → project-context;
  ADR-040/041) keep resolving. The truly-unified single-projection wire is a **separate, later,
  optional** FE + auth-proxy story — explicitly out of this ADR's scope.

Rationale (vs. the alternatives): **pure event-sourcing (status quo)** keeps the exact
forgot-to-emit invariant the pivot deletes; **pure snapshot** breaks the ADR-027 wire contract
if the FE projection is derived naively from XState-internal snapshot shape (the auth-proxy KPI
sniffer reads literal state strings). Hybrid threads the needle: the projection is derived from
live actor state (so "in `project_selected`" ⟺ "projection says `project_selected`," no gap),
while the 4-field byte-stable log survives for audit + streaming.

> ADR-030's pre-costed **store model** (one settled-state record per `flow_id`) is the more
> aggressive sibling of this recommendation and remains the fallback if the team later wants
> maximum deletion of the log. Hybrid is chosen now only because it preserves the existing SSE
> stream + audit trail with less FE churn.

### 3. This records the firing of ADR-030's emission-completeness tripwire

ADR-030 (2026-05-16) pre-committed: the proposal to enforce emission-completeness *by
construction* is itself the signal to instead **replace the event-sourced projection with a
simpler server-authoritative store**. The ChatApp pivot reaches that boundary from the other
direction — rather than building a compile-time guard that makes "settle without emitting"
unrepresentable, it makes the **live actor the state-of-record**, so the invariant is no longer
load-bearing for correctness. The hybrid substrate (§2) is the concrete, less-aggressive
realization of the tripwire's pre-costed alternative; the log is kept (for audit/SSE) rather
than deleted, but it stops being the rebuild mechanism, which is what removed the invariant's
teeth. This ADR is the explicit "the tripwire fired, here is what we did about it" record the
amendment asked a future contributor to write.

### 4. Inside-out build order (core first, boundaries last)

| Phase | Scope | Orchestrator |
|---|---|---|
| **0** | Characterization net over the orchestrator's four responsibilities (the executable spec ChatApp must satisfy) | live |
| **1 (this slice)** | ChatApp core in isolation with FAKE children; pure statechart unit tests; safe `lib/domain/` file moves | live (untouched) |
| **2** | Wire the REAL children via the `.provide({ actors })` seam; run Phase-0 characterization in-process | live |
| **3** | Reconcile persistence (the §2 hybrid): `getPersistedSnapshot` restart + derived-view projection mapper, contract-tested byte-stable | live |
| **4** | Swap the composition root; re-point routers; **delete** the orchestrator + its scaffolding | **deleted** |

The orchestrator cannot be deleted until ChatApp subsumes **all four** of its responsibilities
(spawn hand-offs, freeze/thaw, terminal emission, projection resolution); hence it is deleted
last, not first.

---

## Phase 1 — what landed in this slice

Additive only; nothing else changes behavior.

- **New machine** at `ui-state/lib/machines/chat-app/` (`machine.ts` + `setup/{types,guards,actors}.ts` + `index.ts` + `README.md`), mirroring the `session-onboarding` layout. (Actions are inline in `machine.ts` — a mixed `assign`/`enqueueActions` bundle is not assignable to `setup({ actions })`; inlining lets `setup` infer each action's generics. The split is "as needed.")
- **Two parallel regions** (`lifecycle`, `connectivity`) per §1, with `onSnapshot` child-watching, `entry: sendTo` hand-offs, a parent-held replay buffer, and a multi-target `REAUTH_FAILED → live + rejected`.
- **Dependency-injected children** via `setup({ actors })` placeholders swapped through `machine.provide({ actors })`. (XState's `provide` is type-invariant in a child's context, so the swap site casts to `ChatAppChildLogic` — a runtime no-op; the parent reads child readiness through `onSnapshot` snapshot views.)
- **FAKE children** (`fakes.ts`, test scope): a drivable fake onboarding (→ `ready`), project-context (→ `project_selected`, + switch), and a recording session-chat. Drivable (not auto-advancing) so a test can park any phase and prove the freeze region is orthogonal.
- **Pure statechart unit tests** (`machine.test.ts`, 16 cases): happy cycle; hand-offs reach the right child (asserted on the fakes' recorded inboxes); freeze/thaw (held-not-forwarded → replay in order; REAUTH_FAILED → rejected); freeze orthogonal in onboarding + project_context phases; project-switch re-forward + idempotency; unknown events ignored.
- **Safe `lib/domain/` file moves** (pure/test-only, risk-free): `active-scope.test.ts`, `flow-event.test.ts`, `flow-id.test.ts`, and `projection.ts` + `projection.test.ts` + `projection-property.test.ts` co-located with their already-moved subjects; all import paths updated; the existing suite stays green (import-path changes only).

**Explicitly NOT done in Phase 1** (later phases — left entirely alone): wiring the real children; persistence/serialization/Redis/`getPersistedSnapshot`/projection contract; the orchestrator, `dispatchAndSettle`, `wait-for-settled-state.ts`, `FrozenState`, the actor registry, the strategies; ChatApp into live `index.ts`/HTTP routing.

---

## Phase 3 — what landed in this slice (the §2 hybrid persistence)

Additive only; the live app, the orchestrator, and the event-log fold path are untouched (boundaries are Phase 4). Built + tested on ChatApp in isolation.

- **Derived-view projection mapper** at `ui-state/lib/machines/chat-app/projection/derive-projection.ts`: a PURE `deriveProjection(snapshot, wireMachineName, bookkeeping) → FlowProjection` that reproduces the per-machine ADR-027 envelope from a ChatApp actor snapshot, BYTE-IDENTICAL to today's `buildProjection` log fold. It picks the child slice by wire name (`login-and-org-setup` → onboarding, `project-and-chat-session-management` → project-context, `session-chat` → session-chat; canonical aliases resolve too — R7), maps `child.value` → projection `state` via an explicit per-machine table (overwhelmingly identity — the children were named to the ~21-state vocabulary), builds the `context` from `initialContext()` defaults overridden only by the fields the machine's event handlers write, reuses the SAME `deriveActiveScope` tier logic, and applies the **freeze overlay** (`connectivity:frozen` → `freeze` for the J-002 machines + `expired_token` for login, with `last_live_state` from the live child value). `sequence_id`/`last_event_at`/`request_id` stay **log-sourced** (`bookkeepingFromLog`) — the log is RETAINED for SSE/audit (§2), STATE comes from the snapshot, so there is no "forgot-to-emit" gap for state yet the envelope stays complete.
- **`projection.ts` made reusable** (behavior-preserving refactor, guarded by its existing tests): exports `ReducedContext`, `initialContext()`, and the extracted `deriveActiveScope()` — so the mapper does not duplicate the context shape or the scope tiers divergently.
- **Onboarding-outcome retention** in the ChatApp machine (additive): the phase-scoped onboarding child is STOPPED on the advance to `engaged`/`rejected` and disappears from the snapshot, but the FE root loader reads `login-and-org-setup` on every request — so the parent now RETAINS the onboarding outcome (`onboarding_result`, captured on both onSnapshot arms) as the state-of-record for that slice. `auth_handoff` keeps its exact prior shape; existing tests stay green.
- **R1 golden / contract tests** (`derive-projection.contract.test.ts`, 12 cases): drive the REAL wired ChatApp to each scenario the integration suite exercises (login→project→chat; needs_org; error_recoverable+cause; project_selected; switching_project; session_active; freeze; session_rejected), snapshot it, and assert `deriveProjection` === `buildProjection(equivalent log)` field-by-field. Pin the auth-proxy literals (`state ∈ {ready, error_recoverable}`, `context.underlying_cause_tag`, absent `silent_reauth_ok`) and the FE reads (`context.org/user/project`, `session_list`, `active_scope`). Plus `derive-projection.test.ts` (16 pure unit cases over hand-built snapshot views).
- **Snapshot restart recovery**: a `ChatAppSnapshotStore` port + Redis/noop adapters (`lib/persistence/chatapp-snapshot-store.ts`, mirroring `redis.ts` capability-presence dispatch; ONE record per principal at `ui-state:chatapp:{principal}:snapshot`, distinct from the event-log keyspace), and a recovery seam (`lib/machines/chat-app/snapshot.ts`: `persistChatApp`/`rehydrateChatApp`/`loadChatAppSnapshot`/`saveChatAppSnapshot` + the R3 `isSettledForSnapshot` settled-states-only guard). Tests round-trip a REAL wired ChatApp through the store (JSON), rehydrate via `createActor({ snapshot })`, and confirm lifecycle/connectivity + child states restore, the parent freeze buffer survives, and an in-flight invoke **self-heals** on the real wired machine (R3 reproduced).

**Explicitly NOT done in Phase 3** (Phase 4): wiring any of this into the live `ui-state/index.ts` bootstrap, the `/projection` + `/projection/stream` endpoints, or `orchestrator.projectionFor`; the append-only `FlowEventLog` stays the load-bearing state-of-record on the live path; the children's `freeze`/`THAW` handlers are untouched.

---

## Phase 4 — what landed in this slice (the live wire-swap + orchestrator deletion)

The orchestrator is **deleted**; ChatApp is the live ui-state coordinator. ADR-044
is complete.

- **Live composition root swapped** (`ui-state/index.ts`): `buildChatAppApp`
  replaces `buildSessionOnboardingApp`. It builds `ChatAppDeps` (the project-context
  + session-chat resolver actors), selects the `FlowEventLog` + `ChatAppSnapshotStore`,
  and mounts ONE router factory (`lib/machines/chat-app/router.ts`) under every wire
  path. One **ChatApp actor per principal** (in-memory registry — ui-state is
  single-replica, ADR-030 §SD2 — backed by the snapshot store for hot restart)
  serves all three machines' projections: cold-start bootstraps onboarding and the
  parent cascades to project-context + session-chat internally (ADR-028 onSnapshot
  hand-offs), so the project/chat projection serving the old live app had dropped
  (it was session-onboarding-only) is **restored** from the single actor.
- **Routers re-pointed to the ChatApp actor + the derived view.** `/begin`
  (onboarding cold-start), `/event` (the closed onboarding ACL preserved verbatim;
  a generic `child_event` forward-to-active-child for the rest;
  `switching_project_intent` → the parent `PROJECT_SWITCH`), intent-shaped
  `/open-deep-link` (→ the project-context child's `open_deep_link`), `/projection`
  and `/projection/stream` all driven by `deriveProjection(snapshot, wireMachine,
  bookkeepingFromLog(log))`. The legacy alias machine names keep resolving
  (`childIdForWireMachine`); the `GET /flow/{machine}/projection` envelope is
  **byte-stable** (the derive-projection contract tests stay green) and `flow_id` is
  synthesized `{wireMachine}:{principal}` verbatim.
- **Hybrid persistence is live** (§2): `getPersistedSnapshot()` via the
  `ChatAppSnapshotStore` is the state-of-record (settled-states-only saves; R3
  self-heal on restart); the append-only event log is RETAINED but demoted to
  SSE/audit + projection bookkeeping (keyed by the canonical child so alias paths
  share one log). No `buildProjection` log-fold on the live read path (a cold read
  derives from a synthetic empty snapshot view).
- **Deleted** (the orchestrator's coordination role + its scaffolding, only after
  ChatApp subsumed its non-retired responsibilities): `lib/orchestrator.ts`
  (`FlowOrchestrator`, `BeginFlowOrchestrator`, `FlowActorRegistry`, `FrozenState`,
  `FLOW_STRATEGY_REGISTRY`), `lib/orchestrator-harvester.ts`,
  `lib/wait-for-settled-state.ts`, the three per-machine `strategy.ts` + `router.ts`,
  the six `orchestrator*.test.ts` characterization suites (their live behavior is
  re-covered by `integration.test.ts` + `derive-projection.contract.test.ts` + the
  rewired `index.test.ts`; the freeze family retires with the orchestrator per
  ADR-043), the orchestrator-coupled `flow-router.ts` helpers
  (`mountUniformFlowRoutes`/`freezeThawHandler`/`resultToJson` — `requestIdMiddleware`
  is kept), and the dead `index.old.ts` / `index.old.test.ts`.
- **Freeze/thaw retired end-to-end** (ADR-043): the `/freeze` + `/thaw` endpoints are
  gone, and the children's `on.FREEZE` / `freeze` side-state / `THAW` /
  `replay_abandoned` handlers were removed from `project-context` + `session-chat`.
  `last_live_state` is RETAINED in session-chat — it is load-bearing for the
  INTERACTIVE `retry_clicked` handler, independent of the retired freeze path.

This realizes ADR-044 §4 Phase 4 and §"Inside-out build order": the orchestrator is
deleted last, once ChatApp provably subsumes spawn hand-offs, terminal emission
(now state-of-record + derived view), and projection resolution — with freeze/thaw
retired rather than re-implemented (the §5 OQ#2 / 2026-05-28 amendment resolution).

---

## Consequences

**Positive**

- Declarative choreography: the hand-offs + freeze become one readable statechart instead of a settle-chain threaded across three files.
- Freeze becomes an orthogonal parent region — no per-child `FREEZE` broadcast, no per-child `last_live_state` history bookkeeping.
- The forgot-to-emit failure class loses its teeth once the actor is the state-of-record (§3).
- ADR-028 is honored more faithfully (a real root actor mediating parent-ignorant children).

**Costs / risks**

- **Invoked-child snapshot rehydration** is the central persistence risk (in-flight invokes are not resumed; child snapshot shapes are version-coupled). Mitigated by ADR-027's flush-on-deploy keyspace (snapshots are ephemeral, fine for hot restart) and by a Phase-3 spike before committing — **do not derive the FE projection from raw snapshot internals; derive through a contract-tested mapper.**
- The ADR-027 wire contract is the highest risk and must stay byte-stable until a separate FE + auth-proxy ripple (§2).
- The freeze region's ultimate retention is a live reconciliation with ADR-043 (§5 below).

---

## §5 Open questions (deferred)

1. **Hybrid vs. full store model** — Hybrid now (preserves SSE + audit, least FE churn); ADR-030's store model is the more aggressive fallback.
2. **Freeze region vs. ADR-043** — ~~Phase 1 builds `connectivity` injectable + inert. Whether ChatApp wires a live freeze/reauth path (only meaningful with a future backend-401 boundary, review R4) or leaves it retired per ADR-043 is settled when boundaries land (Phase 4).~~ **RESOLVED 2026-05-28 — TOWARD REMOVAL. See the amendment below.**
3. **Unify the external projection wire** (one ChatApp projection instead of per-machine) — a follow-on FE + auth-proxy story, not required for the pivot.
4. **`sequence_id` monotonicity** in the derived view — keep appending to the per-machine log for streaming so `sequence_id` stays event-count-derived; confirm SSE cursor semantics survive (Phase 3).

---

## Amendment 2026-05-28 — §5 Open Question #2 RESOLVED: remove the `connectivity` region

**Status:** Accepted · **Decision:** REMOVE (resolve OQ#2 toward removal) · **Grounds:** [ADR-043](adr-043-retire-ui-state-token-lifecycle-modeling.md)

§5 OQ#2 deferred the keep-vs-remove decision for ChatApp's parent-level
`connectivity` (`live ⇄ frozen`) region — built injectable + inert in Phase 1
(§"Phase 1 — what landed") — until boundaries land. This amendment resolves it
**toward removal**, applying ADR-043's logic directly:

- **ADR-043 retired ui-state's token-lifecycle modeling** (freeze/thaw +
  silent-reauth) because **auth-proxy owns the token lifecycle** ([ADR-016](adr-016-auth-proxy-in-test-stack.md)).
  Inbound requests reaching ui-state are already authenticated, and outbound
  backend calls refresh transparently — so ui-state is **never** a
  token-management participant. A backend-401 is an ordinary upstream error, not
  a ui-state "reauth" event. The `connectivity` region modeled exactly the
  participation ADR-043 says ui-state does not have.
- **The "future backend-401 boundary" (review R4) that would have justified
  keeping the region did not materialize**, and ADR-043 establishes it is the
  wrong layer for it regardless. Keeping an inert region as a speculative home
  for semantics that belong elsewhere is dead structure, not optionality.
- **chat-app is not yet wired into the live HTTP app** (`index.ts` wires only
  session-onboarding), so this is a removal in a not-yet-live coordinator —
  **no live-path behavior change.**

**What was removed** (this refactor):

- `machine.ts` — the `type: "parallel"` wrapper collapses to a single lifecycle
  region (`initial: "onboarding"`); the `connectivity` region, the `holdIntent` /
  `replayHeldIntents` actions, the `held_events` context field, and the
  `REAUTH_FAILED` multi-target are deleted. The live intent router moves to a
  top-level `on: { user_intent }` handler (`forwardIntentToActiveChild`).
  `user_rejected` remains reachable via the onboarding `isUserRejected`
  `onSnapshot` arm.
- `setup/types.ts` — `ChatAppConnectivity`, the `held_events` field, and
  `TOKEN_EXPIRED` / `REAUTH_OK` / `REAUTH_FAILED` from `ChatAppEvent` are removed.
- `projection/derive-projection.ts` — the freeze overlay is removed end-to-end:
  the snapshot `value` shape collapses (no `connectivity` read), and the `frozen`
  param + the `expired_token` / `freeze` + `last_live_state` mappings are dropped.
  The derived `FlowProjection` for every machine continues to be byte-identical
  to the `buildProjection` log fold for the **non-frozen** states (the only
  states ui-state ever reports, per ADR-043).

**Consequence for §1 / "Persistence direction":** the description of ChatApp as a
two-region parallel machine (§1, Consequences "Freeze becomes an orthogonal
parent region") is **superseded by this amendment** — ChatApp is a single-region
lifecycle coordinator. The orchestrator's own `/freeze` + `/thaw` failure-sim
endpoints are a separate, still-live concern and are untouched here.
