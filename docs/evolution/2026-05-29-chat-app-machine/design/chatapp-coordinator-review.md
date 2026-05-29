# ChatApp Coordinator Machine — DESIGN Review (read-only)

**Reviewer:** Hera (nw-ddd-architect), Propose mode
**Date:** 2026-05-25
**Repo state:** `main` (HEAD at review time)
**Scope:** Read-only assessment of replacing the imperative `FlowOrchestrator`
with an overarching `ChatApp` XState v5 coordinator machine that cycles
login → project-context → chat-context and back. Direction is largely decided;
this review refines, de-risks, and sequences it.

> Source-tree note: this review references the `lib/orchestrator.ts`,
> `lib/machines/{session-onboarding,project-context,session-chat}/`,
> `lib/domain/`, `lib/projection.ts`, and `lib/persistence/redis.ts` modules,
> plus ADR-027/028/030, the FE `frontend/app/lib/ui-state-client.ts` +
> `root.tsx`, and `auth-proxy/app.ts`.

---

## 0. TL;DR (decision-ready)

- **Direction: GO.** A `ChatApp` parent machine is the right shape, and "throw
  away the orchestrator, keep the child machines" is the correct judgment. The
  child machines are clean statecharts already honoring ADR-028. The
  orchestrator is where the accidental complexity concentrated: a hand-rolled
  cross-machine settle-chain, a freeze/thaw broadcast, a flat actor registry,
  and ~7 sanctioned-snapshot harvest sites. ADR-030's 2026-05-16 amendment
  ("emission-completeness tripwire") **pre-authorizes** this move almost
  verbatim.

- **One material refinement to the proposal: do NOT collapse persistence to a
  single unified ChatApp event stream yet.** The FE (`root.tsx`,
  `sessions.tsx`, `chat.tsx`, `projects.tsx`) and auth-proxy KPI sniffing both
  read **per-`flow_id` `FlowProjection` envelopes** over the wire
  (ADR-027 §4). That wire contract is the make-or-break constraint. Keep the
  per-machine projection as a **derived view** of ChatApp state regardless of
  whether the internal substrate becomes ES, snapshot, or hybrid. Treat
  "unify the persistence unit" as an **internal** refactor that must leave the
  external per-machine projection contract byte-stable until a separate,
  sequenced FE+auth-proxy ripple lands.

- **Persistence recommendation: HYBRID.** Internal hot-state = XState v5
  `getPersistedSnapshot()` of the ChatApp actor (parent + invoked children) for
  restart recovery; **keep an append-only event log as the projection source
  AND audit trail**, but stop treating it as the rebuild-the-actor mechanism.
  This is the cheapest path that (a) preserves the ADR-027 wire contract,
  (b) kills the "forgot-to-emit" invariant ADR-030's tripwire flagged, and
  (c) keeps the auth-proxy/FE KPI surface intact. Pure-snapshot is viable later
  but breaks the projection contract if adopted naively; pure-ES keeps every
  problem the pivot is trying to delete.

- **Build order: core-first is right, with one hard sequencing constraint** —
  the orchestrator cannot be deleted until ChatApp subsumes *all four* of its
  responsibilities (spawn hand-offs, freeze/thaw, terminal emission, projection
  resolution). Write characterization tests against the current orchestrator
  behavior FIRST; they become the executable spec the ChatApp machine must
  satisfy before the orchestrator is removed.

---

## 1. Direction assessment — is the unified ChatApp coordinator the right call?

### What the current model actually is

The "three independent machines + an orchestrator" model is, on inspection, a
**parent coordinator implemented imperatively in plain TS**. Everything a
parent statechart would own is present in `FlowOrchestrator`, just hand-rolled:

| Parent-coordinator concern | Where it lives today | Form |
|---|---|---|
| Child lifecycle / spawn | `beginIfNotStartedCore`, `FlowActorRegistry` | `Map<flow_id, actor>` + `createActor` |
| Hand-off: auth → project | `settle()` returns `authReady` → pump fires `beginIfNotStarted(project-context)` | imperative callback |
| Hand-off: project → chat | `maybeFireProjectReady` | imperative callback |
| Cross-machine freeze | `broadcastFreezeCore` / `broadcastThawCore` | for-loop `actor.send(FREEZE)` + per-flow `FrozenState` buffer |
| Replay buffer | `FrozenState.queued` + `replaySeq` two-pass THAW | bespoke FIFO-across-flows |
| Terminal emission | `dispatchAndSettle` 3-strategy settle chain | unconditional sequential calls + state-gated arms |
| Projection resolution | `projectionFor` → `buildProjection` | event-log fold |

ADR-028 already mandates "one root orchestrator actor per process" and
"cross-machine signaling via `system.get(...).send(...)`". The current code
**does not actually implement that** — the orchestrator is a class, not an
actor, and signaling is a manual `for...of actors.entries()` loop. So the pivot
is not a departure from the ratified architecture; **it is the first faithful
implementation of ADR-028's stated intent.** That is a strong point in its
favor — it closes a latent ADR-028 drift rather than opening a new ADR.

### What ChatApp buys

1. **Declarative choreography.** `authReady → spawn project-context` and
   `projectReady → spawn session-chat` become parent transitions on child
   `onDone`/forwarded events — visible in one statechart, not threaded through
   `settle()` return signals + pump callbacks across 3 files.
2. **Freeze/thaw as parent state, not a broadcast.** A parent `frozen` state
   that pauses children replaces `broadcastFreezeCore`'s mark-then-loop and the
   per-flow `FrozenState` map. The 5s window + replay buffer become parent
   `after` timers + a parent-context queue (or, better, are reconsidered — see
   §6 risk on whether the buffer is still needed).
3. **ADR-028 honored *more* faithfully.** Children still never import each other;
   the parent is now a real actor mediating them, which is what ADR-028 said.
4. **The imperative scatter goes.** The settle-chain, the 3 unconditional
   `strategy.settle` calls, `dispatchAndSettle`, `waitForSettledState`,
   `waitForLeavingState`, and the snapshot-harvest sites all collapse into
   parent transitions + child `onDone` data.

### What it costs

1. **Invoked-child persistence is the central risk** (see §4). XState's
   `getPersistedSnapshot()` of a parent with invoked children is powerful but
   has real gotchas (in-flight invokes are not resumed; child snapshot shapes
   are version-coupled to machine definitions).
2. **The settle-chain is also where FlowEvents are *emitted*.** The orchestrator
   does double duty: it advances the actor AND writes the projection's events.
   ChatApp can advance the actors declaratively, but **something still has to
   produce the per-machine projection** the FE/auth-proxy read. That logic does
   not vanish; it relocates (to parent `entry`/`exit` actions or to a projection
   derived from snapshot — §4 resolves which).
3. **Migration risk concentrated in one seam.** Today the three flows are
   independently re-enterable (`/begin force_restart` resets ONE flow). Under a
   unified machine, independent re-entry must be preserved by design, not by
   accident (§4.3).

### Verdict on "throw away orchestrator, keep children"

**Endorsed.** The children pass the ADR-028 discriminating test (context =
internal handler state; contracts flow via `event.output`/projection). They are
not the problem. The orchestrator is the 1400-line concentration of
hand-rolled coordination + emission. Deleting it in favor of a parent machine
is the correct target — provided the per-machine projection wire contract is
preserved as a derived view (§4).

---

## 2. The ChatApp cycle model (the user's first priority)

The cycle is **login → project-context → chat-context**, with reverse paths for
token-expiry (freeze/reauth) and project-switch. Model ChatApp as a top-level
machine with one **parallel region for the freeze overlay** so freeze does not
have to be re-declared per child-phase.

### Proposed statechart (ASCII)

```
ChatApp  (parallel: { lifecycle, connectivity })
│
├── region: lifecycle
│   │
│   ├─ onboarding            invoke: session-onboarding child
│   │     │   on child → ready (org resolved)        ──► project_context
│   │     │   on child → session_rejected            ──► rejected (terminal)
│   │     │   on child → needs_org / creating_org    (stay; child handles)
│   │
│   ├─ project_context       invoke: project-context child
│   │     │     (entry: forward auth_ready{org_id,user} into child)
│   │     │   on child → project_selected            ──► chat
│   │     │   on child → scope_mismatch_terminal     (stay; surfaced via projection)
│   │     │   on child → no_projects / creating      (stay; child handles)
│   │
│   ├─ chat                  invoke: project-context AND session-chat children
│   │     │     (entry: forward project_ready{project} into session-chat)
│   │     │   on session-chat events                 (stay; child handles)
│   │     │   on PROJECT_SWITCH (child project-context → switching_project
│   │     │       → project_selected, new id)        ──► chat (re-enter:
│   │     │                                               re-forward project_ready
│   │     │                                               to session-chat)
│   │
│   └─ rejected              terminal-ish (re-/begin restarts the cycle)
│
└── region: connectivity     (the freeze overlay — orthogonal to lifecycle)
    │
    ├─ live                  (default)
    │     │   on TOKEN_EXPIRED (from onboarding child's expired_token,
    │     │       OR — future — the backend-401 boundary)               ──► frozen
    │
    └─ frozen
          │   entry: pause children (stop forwarding intents; buffer or drop)
          │   invoke: silentReauth (re-verify / reissue)
          │   on reauth success                                          ──► live
          │       (exit: thaw — re-forward buffered intents OR re-enter
          │        the children's in-flight invoke states with fresh creds)
          │   after(5000) / buffer overflow                              ──► live
          │       (but mark abandoned → children fall to error_recoverable)
          │   on reauth failure                                          ──► live
          │       (mark abandoned)
```

### How this maps the requirements

- **Forward cycle** is the `lifecycle` region's happy path: each phase invokes
  the next child and the child's terminal event (`ready`,
  `project_selected`) is the parent transition trigger. The
  `authReady`/`projectReady` hand-offs that are imperative pump callbacks today
  become **parent `entry` actions forwarding an event into the next child** +
  **parent transitions on child output** — exactly the declarative version of
  `settle() → beginIfNotStarted()`.

- **Reverse path: project switch.** Today this is `switching_project_intent`
  inside project-context → `project_selected` → orchestrator re-broadcasts
  `project_ready`. Under ChatApp, the parent observes the project-context child
  re-entering `project_selected` with a new id and **re-forwards `project_ready`
  to the session-chat child** (its existing `project_ready` handlers already
  invalidate session_id/resource/list on a different project_id — see
  `session-chat/machine.ts` `project_ready` guards). No parent state change
  needed beyond a `chat` self-re-enter; the children already do the work.

- **Reverse path: token expiry.** This is the **single biggest structural win**.
  Today freeze is a *broadcast* (`broadcastFreezeCore` loops every actor, marks
  `FrozenState`, and each child has a top-level `on.FREEZE → .freeze`
  side-state). Under ChatApp, freeze becomes the **`connectivity` parallel
  region entering `frozen`**. Because it is a parent region orthogonal to
  `lifecycle`, it applies regardless of which lifecycle phase is active —
  precisely what the broadcast was simulating. The children's own `freeze`
  side-states (and the `FREEZE`/`THAW` events they declare) can be **retired**:
  the parent pauses them by ceasing to forward intents and, on thaw, re-forwards
  buffered intents or re-enters their in-flight invoke. (See §3 for the exact
  pause mechanism and §6 for the open question on whether the children's
  `freeze` states are kept short-term for migration safety.)

### Why a parallel region rather than a `frozen` super-state

A single `frozen` super-state wrapping all of `lifecycle` would force you to
re-declare or history-restore the entire lifecycle on thaw. A parallel
`connectivity` region freezes *orthogonally*: `lifecycle` stays in (say)
`chat`, `connectivity` flips `live → frozen → live`, and on thaw `lifecycle`
is untouched — its children resume. This is the statechart-native expression of
"freeze pauses everything in place," and it is strictly simpler than the
current per-child `last_live_state` history-target bookkeeping.

---

## 3. Child coordination mechanism (XState v5)

### invoke vs spawn

**Use `invoke` for the children, keyed by `id`.** Rationale: _(corrected
2026-05-29: originally said "keyed by `systemId`"; parent sendTo/snapshot
resolution is keyed by the invoke `id`, not `systemId` — see the §3 note below.)_

- The children are **phase-scoped**: project-context is meaningful while
  `lifecycle ∈ {project_context, chat}`; session-chat while `∈ {chat}`.
  `invoke` ties child lifecycle to the parent state that needs it — entering
  `chat` invokes session-chat; leaving it (rejected/logout) stops it. That is
  exactly the lifecycle the orchestrator hand-manages via
  `beginIfNotStarted`/`recycleActor` today.
- `invoke` participates in `getPersistedSnapshot()` automatically — the parent
  snapshot includes invoked-child snapshots. `spawn`'d actors stored in context
  are also persisted, but invoke gives you declarative start/stop tied to state,
  which is what you want for a phase machine.
- **Caveat:** the `chat` phase needs BOTH project-context (still live, for
  switching) AND session-chat. Either keep project-context invoked across
  `project_context` + `chat` (one invoke declared on a parent ancestor state
  that encloses both), or invoke it on the parallel region. The cleanest is to
  invoke project-context on a state that is an ancestor of both
  `project_context` and `chat`, and session-chat on `chat` only.

Assign each child a stable `id` (`onboarding`, `project-context`,
`session-chat`). The v5 actor `system` lets any actor resolve a sibling by
`systemId` — but **do not use that to bypass the parent.** ADR-028's "no machine
knows another" stands. _(corrected 2026-05-29: the parent's own
`sendTo`/observability and snapshot-identity stability across restart all resolve
through the invoke `id` via `snapshot.children[id]`, NOT `systemId`. `systemId`
only matters for cross-hierarchy `system.get(systemId)`, which this design never
uses — so the redundant `systemId` declarations were removed.)_

### parent ↔ child messaging

- **Parent → child:** `sendTo('project-context', { type: 'auth_ready', ... })`
  in the parent `entry` action of `project_context`;
  `sendTo('session-chat', { type: 'project_ready', ... })` in `entry` of
  `chat`. These replace `beginIfNotStartedCore`'s `actor.send({type:'auth_ready'})`
  / `maybeFireProjectReady`.
- **Child → parent:** children signal readiness. Two options:
  1. **`onDone`-style** — only works if the child is a "final-state" machine;
     ours are long-lived (they cycle), so `onDone` is the wrong tool for the
     steady-state hand-offs.
  2. **`sendParent` / forwarded events** — the child emits a domain event the
     parent listens for. But ADR-028 says children don't know about siblings;
     they *can* know about their parent (that is not sibling coupling). The
     low-coupling option: the parent **subscribes to the child's snapshot**
     (`invoke` + an `onSnapshot` transition in v5) and transitions when the
     child's state value hits `ready` / `project_selected`. This keeps the child
     ignorant of the parent entirely — the parent watches, the child just runs.
     **Recommended:** `onSnapshot` guards on child state value. This is the
     declarative equivalent of the orchestrator's `priorState` watcher that
     fires hand-offs on entry into `ready`/`project_selected`.

### How the hand-offs become parent transitions

| Today (imperative) | Under ChatApp (declarative) |
|---|---|
| `sessionOnboardingStrategy.settle` returns `authReady` → pump `beginIfNotStarted(project-context, {org_id, first_name})` | `onSnapshot` on session-onboarding child: `guard: child.state === 'ready'` → parent `project_context`; `entry: sendTo('project-context', auth_ready{...})` (payload read from child snapshot via the parent's own harvest — see §4 on where that read is now legal) |
| `projectContextStrategy.settle` returns `projectReady` → `maybeFireProjectReady` | `onSnapshot` on project-context child: `guard: child.state === 'project_selected'` → parent `chat`; `entry: sendTo('session-chat', project_ready{...})` |
| project switch re-broadcast | `onSnapshot` on project-context detects `project_selected` with a changed project id → re-`sendTo('session-chat', project_ready{...})` |

### How children stop needing the freeze broadcast

Today each child declares top-level `on.FREEZE → .freeze` (a side-state with no
invoke) + `on.THAW` with one guarded arm per freezable state restoring
`last_live_state`. Under ChatApp:

- The parent's `connectivity:frozen` state is the freeze. The parent **stops
  forwarding intents** to children while frozen (the parent is the only intent
  router now — the HTTP `/event` lands at the parent, not directly at a child).
- "Pause the child" = the parent simply does not `sendTo` the child while
  `connectivity = frozen`; the child sits in whatever state it was in. If the
  child had an **in-flight invoke** (e.g. `resuming_session`), XState keeps it
  running — so the parent either (a) lets it complete and buffers the *result's*
  follow-on, or (b) you keep a thin child `freeze` state short-term for the
  in-flight-invoke-cancel semantics (the children's `freeze` comment notes "the
  in-flight invoke … is stopped by XState so a mid-flight 401 is discarded").
  **Recommendation:** keep the children's `freeze`/`THAW` handlers during the
  migration (they are already tested), drive them from the parent `frozen`
  region's entry/exit `sendTo`, and only delete them once the parent-pause
  mechanism is proven against the characterization tests. This is the safe
  sequencing — see §5.

---

## 4. THE CRUX — persistence / projection paradigm

### The hard external constraint (verified in code)

The per-`flow_id` `FlowProjection` envelope is a **live wire contract with three
independent consumers**, not an internal detail:

1. **FE root loader** (`frontend/app/root.tsx`) reads TWO projections per
   request: `client.getProjection("login-and-org-setup")` AND
   `client.getProjection(PROJECT_FLOW_MACHINE)`, then reads
   `projection.state`, `projection.active_scope`, `projection.context.*`.
2. **FE route loaders** (`sessions.tsx`, `chat.tsx`, `projects.tsx`) each read a
   per-machine projection.
3. **auth-proxy KPI sniffing** (`auth-proxy/app.ts` `emitKpiEventsForResponse`)
   parses the projection envelope `{ state, request_id, context:
   { underlying_cause_tag, silent_reauth_ok } }` off `/ui-state/flow/*` responses
   to emit K3 KPIs (`ready_reached`, `auth_recoverable_error_shown`,
   `silent_reauth_failed`, `silent_reauth_ok`).

All three hit `GET /ui-state/flow/{machine}/projection`, where the server
derives `flow_id = {machine}:{principal}` and returns one `FlowProjection`. The
shape is frozen by ADR-027 §4. **This is the single thing that cannot break
silently.**

### Therefore: the persistence pivot must NOT collapse the external projection

The user's stated goal — "drop a flow_id per child machine as the persistence
unit; serialize ChatApp + child-reconstitution" — is sound **as an internal
storage decision** but must be decoupled from the **external read contract**.
Concretely:

> **Internal persistence unit** can become "one ChatApp record."
> **External projection unit** must stay "one `FlowProjection` per
> `{machine}:{principal}`" until a separately-sequenced FE + auth-proxy ripple
> retires the per-machine read paths.

The bridge is a **derivation**: `GET /flow/{machine}/projection` returns a
`FlowProjection` *projected from the relevant slice of ChatApp state*. For
`login-and-org-setup` it derives from the onboarding child's state; for
`project-and-chat-session-management` from project-context; for `session-chat`
from session-chat. This is a small, pure mapping function — it is precisely
today's `buildProjection` reading a per-machine slice, just sourced from ChatApp
state instead of a per-machine event log.

### ES vs SNAPSHOT vs HYBRID — recommendation

**Recommend HYBRID, with the event log demoted from "rebuild mechanism" to
"projection source + audit," and `getPersistedSnapshot` added for hot restart.**

| Axis | Pure ES (today, unified) | Pure Snapshot | **Hybrid (recommended)** |
|---|---|---|---|
| Restart recovery | Replay log → rebuild actor | `createActor(machine,{snapshot})` | Snapshot for actor; log present but not load-bearing for rebuild |
| FE/auth-proxy projection | Fold log per machine (today) | Derive from snapshot per machine | Derive from snapshot OR keep folding log — both available |
| Replayability / time-travel | Yes | No | Yes (log retained as audit) |
| Schema evolution | Event-version hell on every reducer | Snapshot shape coupled to machine def — **breaks on any machine edit** | Snapshot is ephemeral (flush-on-deploy, per ADR-027 amendment); log stays simple 4-field |
| "Forgot-to-emit" invariant (ADR-030 tripwire) | **Present** — every settle must emit | **Gone** — state IS the snapshot | **Gone** for actor state; log emission becomes projection-shaping only, not state-of-record |
| Debuggability | Full event trail | Opaque blob | Full event trail + restorable actor |
| Effort | n/a (status quo) | High (projection-derivation rewrite + contract risk) | **Medium — one LEAF-sized** |

Key reasoning:

- **Pure snapshot is a trap for the wire contract.** `getPersistedSnapshot()`
  returns an XState-internal structure coupled to the *exact machine
  definition*. Deriving the FE-facing `FlowProjection` from it is doable but
  fragile, and any machine refactor risks silently changing
  `projection.state`/`context` shape — the auth-proxy KPI sniffer reads literal
  state strings (`"ready"`, `"error_recoverable"`). Per ADR-027's amendment the
  `ui-state:` keyspace is **flushed on deploy**, so snapshots are already treated
  as ephemeral — which means snapshot is *fine for hot restart* but *unfit as
  the canonical projection source*.

- **Pure ES unified keeps the exact problem the pivot deletes.** ADR-030's
  2026-05-16 tripwire names it: event-sourcing + projection rebuild
  "manufactures an invariant" — the orchestrator must emit a FlowEvent on every
  settle or the projection silently goes stale (3 recurrences cited:
  `switching_project`, `session_resumed`, access-revoked arms). Keeping a single
  unified ES log just relocates that hand-policed invariant into ChatApp's
  entry/exit actions. The tripwire explicitly says: when you're about to build
  *more enforcement* for emission-completeness, instead **evaluate replacing the
  event-sourced projection with a simpler store.** This pivot is that moment.

- **Hybrid threads the needle.** XState's snapshot becomes the actor's state of
  record for restart (replaces "rebuild from log"). The projection is **derived
  from the live actor state** (snapshot-shaped, in-process) — so there is no
  "forgot to emit" gap: if the machine is in `project_selected`, the derived
  projection says `project_selected`, full stop. The append-only log is
  **retained** but its role narrows to (a) audit/replay (a real, if currently
  unused, capability) and (b) the SSE `/projection/stream` substrate, which
  already long-polls the log. You keep the 4-field byte-stable record
  (`ts,type,payload,request_id`) — no schema churn.

> Note: ADR-030's pre-costed alternative ("server-authoritative store model:
> one settled-state record per flow_id") is the *purest* expression of the same
> idea and would also work. Hybrid is recommended over it only because it
> preserves the existing SSE stream + audit log with less FE churn. If the team
> wants maximum deletion, the store model is the more aggressive sibling of this
> recommendation — flag it as the fallback.

### How the FE projection contract survives — the concrete answer

**It survives as a derived view; the wire bytes do not change.** Sequence the
internal change behind the external contract:

1. ChatApp becomes the state-of-record (snapshot for restart). Internally there
   is now ONE actor, not three flow_ids.
2. `GET /flow/{machine}/projection` keeps its signature. Its handler changes
   from "fold the per-`flow_id` event log" to "derive the per-machine
   `FlowProjection` from the corresponding ChatApp child slice." The output
   bytes (`flow_id`, `state`, `context`, `active_scope`, `sequence_id`,
   `last_event_at`, `request_id`) stay identical.
3. `flow_id` in the response is **synthesized** as `{machine}:{principal}` (it
   was always derived server-side anyway — the FE never sends it). So the FE's
   two-projection read in `root.tsx` and the auth-proxy state-sniff keep
   working unchanged.

This means the FE+auth-proxy ripple to a *truly unified* single-projection wire
is a **separate, later, optional** story — NOT a prerequisite for the ChatApp
pivot. Do not bundle them. (Flag: `sequence_id` is per-flow monotonic and used
by SSE replay-from-cursor; the derived view must keep producing a coherent
monotonic per-machine `sequence_id` — see §6 open question.)

### Independent re-entry (`/begin force_restart`) under a unified machine

Today `/begin` with `force_restart` resets ONE flow (stop actor + reset that
flow's event log + reset that flow's tracking). Under a unified ChatApp:

- `/begin` for session-onboarding = **start/restart the whole cycle** (the
  onboarding phase is the cycle's entry). `force_restart` = re-enter ChatApp at
  `onboarding` and reset. This is actually *cleaner* — login restart IS a cycle
  restart.
- The subtlety: today a `force_restart` on session-onboarding does NOT
  necessarily wipe project-context/session-chat (separate flow_ids, separate
  logs). Under ChatApp, re-entering `onboarding` should re-drive forward, and
  the children's invokes re-initialize when their phases are re-entered. Verify
  with a characterization test: "force_restart login, then re-resolve project —
  does the user land back in chat with fresh state?" Capture today's behavior
  first, then preserve it.
- **There is no longer a meaningful "restart project-context independently of
  login"** as a separate flow_id reset — and that's fine, because the FE never
  drives that; `/begin` is only ever posted to session-onboarding (see
  `index.ts` — only `buildSessionOnboardingRouter` mounts `/begin`).

---

## 5. Inside-out build plan / phased roadmap

Honors "core first, boundaries last." The **hard constraint**: the orchestrator
is the live coordinator until ChatApp subsumes ALL of its responsibilities, so
it is deleted LAST, not first.

### Phase 0 — Characterization net (do this before writing ChatApp)

Brownfield rule (CLAUDE.md): before refactoring untested coordination, pin it.
The five orchestrator test files are partial characterization already:
`orchestrator.test.ts`, `orchestrator-freeze-replay.test.ts`,
`orchestrator-switching-project.test.ts`,
`orchestrator-switching-dataset-context.test.ts`,
`orchestrator-frozen-state.test.ts`, `orchestrator-legacy-alias.test.ts`.

- Audit these for behavior coverage of the four responsibilities (spawn
  hand-offs, freeze/thaw + replay ordering, terminal emission per state,
  projection resolution). Fill gaps with **black-box characterization tests at
  the HTTP-app level** (`buildSessionOnboardingApp` + noop event log + mock
  fetch) asserting the projection sequence for: happy login→project→chat,
  project switch, token-expiry freeze→reauth→thaw replay, replay-abandoned, and
  `/begin force_restart`. These are the executable spec ChatApp must satisfy.
- **Characterization-worthy specifically:** the two-pass cross-flow FIFO replay
  ordering (`replaySeq`), the `stale_intent_dropped_after_thaw` accounting, and
  the `project_ready` re-broadcast-on-thaw-only-for-transients logic
  (`broadcastThawCore` PC_TRANSIENTS/SC_TRANSIENTS gating). These are the
  subtlest behaviors and the easiest to regress.

### Phase 1 — ChatApp core in isolation, FAKE children

- New `lib/machines/chat-app/` mirroring `session-onboarding/` layout
  (`machine.ts`, `setup/{types,actions,guards}.ts`, plus
  `projection/` for the derived-view mapping).
- Build the `lifecycle` + `connectivity` regions (§2) with **stub children**:
  minimal machines exposing the same state values
  (`ready`, `project_selected`, `session_active`, `freeze`) and accepting the
  same forwarded events (`auth_ready`, `project_ready`, `FREEZE`/`THAW`). No
  network, no Redis.
- Test the parent's choreography purely: does `onboarding-child→ready` advance
  to `project_context` and `sendTo(auth_ready)`? Does `project-child→project_selected`
  advance to `chat` and `sendTo(project_ready)`? Does `connectivity:frozen`
  enter on `TOKEN_EXPIRED` and exit on reauth/timeout? This is the "build one to
  throw away" core — pure statechart unit tests.
- **File moves are safe to do here** (they touch nothing the orchestrator
  needs at runtime): move `active-scope.test.ts`, `flow-event.test.ts`,
  `flow-id.test.ts` into `lib/domain/` alongside their already-moved
  subjects, and move `projection.ts` + `projection.test.ts` +
  `projection-property.test.ts` into `lib/domain/`. These are domain-core
  artifacts; co-locating them with `flow-event.ts`/`active-scope.ts` is correct
  and risk-free (test-only + a pure module). Do this early to reduce churn later.

### Phase 2 — Wire REAL children into ChatApp

- Replace stub children with the real `session-onboarding`, `project-context`,
  `session-chat` machines (via `index.ts` DI — ChatApp's factory takes the three
  child machine factories + their deps as constructor args, per the proposal's
  composition-root requirement).
- The real children's actors (`fromPromise` for network I/O) are injected the
  same way they are today (config/input-driven, no `.provide`). ChatApp's
  `index.ts` is the new composition root constructing ChatApp with the three
  children as dependencies.
- Run Phase 0's characterization tests against ChatApp **in-process** (no
  orchestrator). They must pass. Gaps here reveal choreography mismatches.

### Phase 3 — Reconcile persistence (the §4 hybrid)

- Add `getPersistedSnapshot()` restart recovery for ChatApp (replaces
  per-flow lazy rehydration).
- Re-point `GET /flow/{machine}/projection` to derive the per-machine
  `FlowProjection` from ChatApp's child slice (the derived-view mapper). Keep
  byte-output identical — verify against the FE's `ProjectionShape` and the
  auth-proxy sniffer's expected fields.
- Keep the append-only log for SSE + audit. The SSE `/projection/stream` keeps
  working because it long-polls the log; ChatApp's entry/exit actions still
  append projection-shaping events to the log (now for *streaming + audit*, not
  for state-of-record). **This is the one place the emission discipline lingers
  — but it is no longer load-bearing for correctness** (the actor is the truth;
  a missed append only delays an SSE push, it does not stick the state).

### Phase 4 — Swap the composition root; delete the orchestrator

- `index.ts` (`buildSessionOnboardingApp`) constructs ChatApp instead of
  `FlowOrchestrator` + `BeginFlowOrchestrator` + `FlowActorRegistry`.
- Routers (`/begin`, `/event`, `/freeze`, `/thaw`, `/projection`) re-point to
  ChatApp methods. `/event` now lands at the parent (which forwards to the right
  child); `/freeze`/`/thaw` drive the `connectivity` region.
- **Only now delete:** `lib/orchestrator.ts`, `lib/orchestrator-harvester.ts`,
  `lib/wait-for-settled-state.ts`, the three `strategy.ts` files' settle/emission
  bodies (or the strategies entirely if their begin/router logic folds into
  ChatApp), `FlowActorRegistry`, `FrozenState`, `FLOW_STRATEGY_REGISTRY`.
- Delete the children's `on.FREEZE`/`freeze`/`THAW` handlers **last**, after
  proving the parent-pause mechanism against the freeze-replay characterization
  tests (per §3 recommendation to keep them through migration).

### Sequencing rationale (why this order)

- **Can't delete orchestrator until Phase 4** — it is the live coordinator;
  Phases 1-3 build the replacement beside it.
- **`wait-for-settled-state.ts` removal is Phase 4**, not earlier — the
  orchestrator imports it at runtime; removing it before ChatApp owns settling
  would break the live path. (XState's invoke `onDone` makes it obsolete *inside*
  ChatApp, but the old path still needs it until swapped.)
- **File moves to `lib/domain/` are Phase 1** — risk-free, reduce later churn.
- **Forget routing/backend-API boundaries until Phase 4** — exactly the user's
  "boundaries last." Phases 1-2 are pure in-process statechart work.

---

## 6. Risks & open questions

### R1 — ADR-027 FE/auth-proxy projection contract (HIGHEST)
The make-or-break. Mitigation is §4: keep per-machine `FlowProjection` as a
derived view, byte-stable, until a separate FE+auth-proxy ripple. **Do not let
"unify the persistence unit" leak into the wire.** Add a contract test asserting
the derived projection matches the current `buildProjection` output for the same
event history, machine-by-machine, before Phase 4.

### R2 — Snapshot schema evolution (HIGH)
`getPersistedSnapshot()` shape is coupled to the machine definition. ADR-027's
flush-on-deploy keyspace policy makes this *survivable for hot restart* (a
post-deploy snapshot mismatch just means cold rehydration). But **never derive
the FE projection directly from raw snapshot internals** — derive it through an
explicit mapper that the contract test (R1) pins. Spike: confirm
`createActor(ChatApp, { snapshot })` correctly rehydrates *invoked children*
(see R3).

### R3 — XState invoked-child persistence gotchas (HIGH — SPIKE THIS FIRST)
`getPersistedSnapshot()` includes invoked children's snapshots, and
`createActor(machine, { snapshot })` rehydrates them — BUT **in-flight invoked
promises are NOT resumed**; a child mid-`resuming_session` at snapshot time
rehydrates into `resuming_session` with no running promise. The current code
handles the analogous case via `reenter: true` on thaw. **Spike before Phase 3:**
build ChatApp with one real child, drive it mid-invoke, persist, rehydrate, and
confirm the invoke re-fires (or that you re-enter the transient state on
rehydrate). This single spike de-risks the whole persistence phase.

### R4 — `expired_token` and the not-yet-wired backend-401 boundary (MEDIUM)
Today `expired_token` is entered only by session-onboarding's WorkOS re-verify
401, and freeze is broadcast from there. ChatApp's `connectivity:frozen` is
entered by `TOKEN_EXPIRED`. The **future** backend-401 boundary (a child's
backend call returning 401 mid-flow) fits naturally: any child's invoke `onError`
with a 401 cause can `sendParent({type:'TOKEN_EXPIRED'})` (child→parent is
allowed; sibling→sibling is not). This is *cleaner* than today, where only the
login flow could originate freeze. Model `TOKEN_EXPIRED` as a parent event any
phase can raise; defer the actual backend-401 plumbing (boundaries last) but
leave the parent event in the design.

### R5 — Replay buffer: is it still needed? (MEDIUM — design question)
The current replay buffer (5s window, 16 cap, cross-flow FIFO via `replaySeq`)
exists because freeze was a broadcast and intents arriving at frozen siblings
had nowhere to go. Under ChatApp, **all intents land at the parent**. While
`connectivity:frozen`, the parent can (a) buffer intents in parent context and
replay on thaw (preserves today's behavior, easiest to characterize), or (b)
reject/queue at the HTTP edge. Recommend (a) for behavior-parity in migration,
then evaluate whether the cross-flow FIFO ordering is still meaningful when
there's one intent queue at one parent (it likely simplifies to a plain FIFO —
the cross-flow `seq` complexity may evaporate). Capture current ordering in
Phase 0 tests so any simplification is a *deliberate, tested* change.

### R6 — `sequence_id` monotonicity in the derived view (MEDIUM)
`FlowProjection.sequence_id` is per-flow monotonic (today = event count) and
used by SSE replay-from-cursor. A derived-from-snapshot projection must still
emit a coherent monotonic per-machine `sequence_id`. Simplest: keep appending to
the per-machine log for streaming (Phase 3 retains the log), so `sequence_id`
stays event-count-derived. Confirm the SSE cursor semantics survive.

### R7 — Legacy wire-name aliases (LOW but don't drop)
`login-and-org-setup` → `session-onboarding` and
`project-and-chat-session-management` → `project-context` aliases (ADR-040/041)
are still hit by the FE (`ui-state-client.ts` uses
`"login-and-org-setup"` and `PROJECT_FLOW_MACHINE =
"project-and-chat-session-management"`) and the acceptance harness. The
derived-view projection handler MUST keep resolving these alias machine names to
the right ChatApp child slice. Carry the alias map forward.

### R8 — Two-pass cross-flow THAW replay ordering (LOW likelihood, HIGH if hit)
`broadcastThawCore`'s pass-1-unfreeze-all-then-pass-2-replay-in-global-seq-order
is subtle and exists to handle re-broadcasts during replay reaching live targets.
Under one parent with one queue this likely simplifies, but it is the easiest
behavior to silently regress. Pin it in Phase 0.

### Open questions for the team
1. **Hybrid vs full store model (§4)?** Hybrid preserves SSE+audit with least FE
   churn; the ADR-030 store model deletes more. Recommend Hybrid now, store
   model as a later option. Which appetite?
2. **Keep children's `freeze` states through migration, or cut at Phase 4?**
   Recommend keep-then-cut (safer). Confirm.
3. **Does the team want to *also* unify the external projection wire** (one
   ChatApp projection instead of per-machine), as a follow-on FE+auth-proxy
   story? Not required for the pivot; explicitly out of its scope.
4. **New ADR.** This pivot warrants an ADR ("ChatApp coordinator supersedes
   FlowOrchestrator; persistence moves to hybrid snapshot+audit-log") that
   records it as the firing of ADR-030's 2026-05-16 tripwire. Recommend writing
   it at Phase 1 kickoff so the decision is captured before code.

---

## 7. One-paragraph honest summary

The pivot is right and is the faithful implementation of what ADR-028 always
intended; the children are healthy and should be kept; the orchestrator is the
correct thing to delete. The ONE place to push back on the proposal as stated is
"unify the persistence unit": do it *internally* (ChatApp snapshot for restart,
log demoted to audit/stream) but keep the *external* per-`flow_id`
`FlowProjection` as a derived, byte-stable view — because the FE's two-projection
loader read and auth-proxy's state-string KPI sniffing are live wire consumers
that the proposal's "one unified state" would otherwise break. Build core-first
with fake children, spike invoked-child snapshot rehydration before committing to
the persistence phase, and delete the orchestrator only once ChatApp provably
subsumes all four of its responsibilities against a characterization net.
```
