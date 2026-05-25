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
2. **Freeze region vs. ADR-043** — Phase 1 builds `connectivity` injectable + inert. Whether ChatApp wires a live freeze/reauth path (only meaningful with a future backend-401 boundary, review R4) or leaves it retired per ADR-043 is settled when boundaries land (Phase 4).
3. **Unify the external projection wire** (one ChatApp projection instead of per-machine) — a follow-on FE + auth-proxy story, not required for the pivot.
4. **`sequence_id` monotonicity** in the derived view — keep appending to the per-machine log for streaming so `sequence_id` stays event-count-derived; confirm SSE cursor semantics survive (Phase 3).
