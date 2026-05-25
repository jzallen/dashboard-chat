# ChatApp Phase 4 — Gap Analysis + Staging Plan (PART C Step 0)

**Status:** Step 0 complete. **Landing decision: PART H safety valve** — land this
analysis (additive, docs-only, zero live-behavior change) and STAGE the live
wire-swap + orchestrator deletion as **Phase 4b**, because the gap analysis shows
the gaps are larger than the pre-flight list and several are architecturally
entangled with the deferred wiring (and one is in tension with ADR-043/044).

**Date:** 2026-05-25
**Author:** chat_app_phase4 crew
**Scope:** Investigate the full `ui-state` app assembly, inventory the behaviors the
imperative `FlowOrchestrator` owns vs. what the `ChatApp` parent machine already
subsumes, and decide how Phase 4 lands. Read alongside
[`chatapp-coordinator-review.md`](./chatapp-coordinator-review.md) §3/§5,
[ADR-044](../../../decisions/adr-044-chatapp-coordinator-supersedes-orchestrator.md),
[ADR-043](../../../decisions/adr-043-retire-ui-state-token-lifecycle.md),
ADR-027/028/030.

---

## 0. TL;DR

1. **The live `ui-state` service today serves ONLY the session-onboarding flow.**
   `index.ts` → `buildProductionApp()` → `buildSessionOnboardingApp()` mounts
   exactly `/flow/session-onboarding/*` and its alias `/flow/login-and-org-setup/*`.
   The project-context and session-chat wire paths are **not served** by the live
   composition root, and the live `FlowOrchestrator` is constructed with **no**
   `projectContextMachineDeps` / `sessionChatMachineDeps`, so its auth_ready /
   project_ready spawn hooks are **no-ops**. The project/chat flows are dormant on
   the live path.
2. **`index.old.ts` (the full 3-router composition) is DEAD.** It is excluded from
   `tsc` (`tsconfig.json` excludes `**/*.old.ts`), it imports a deleted
   `lib/machines/login-and-org-setup/` directory, and the `Dockerfile` copies only
   `index.ts` + `lib/`. It is reference scaffolding, not a live entrypoint.
3. **The FE + auth-proxy still READ all three machines' projections.** So wiring
   ChatApp must *restore* project-context + session-chat serving (currently 404)
   while keeping session-onboarding byte-stable. The live FE surface is read-heavy
   (three `GET …/projection` + one intent-shaped `…/open-deep-link`); `/begin`,
   `/event` for project/chat, `postEvent`, and the SSE stream are **acceptance/dev
   or defined-but-unused** today.
4. **The gaps are larger than the pre-flight list.** The decisive one:
   ChatApp's `/event` forwarding vocabulary is a **3-member `ChatUserIntent`**
   union (`session_clicked`, `new_session_clicked`, `refresh_session_list`) plus
   `PROJECT_SWITCH`, while the live wire `/event` surface for project/chat is a rich
   vocabulary (`create_project_submitted`, `switching_project_intent`,
   `first_message_sent`, `dataset_resolved_by_agent`, `dataset_picked_directly`,
   `retry_clicked`, `back_to_projects_clicked`, `open_deep_link`, …). Forwarding the
   full vocabulary through ChatApp (held while frozen, replayed on thaw) is
   substantial additive design + test work. Plus: a **REAUTH_FAILED semantic
   divergence**, a **deep-link legacy-path derived-view gap**, a
   **freeze-during-in-flight-invoke gap**, and **stale-intent / abandonment
   emission** that the snapshot-derived view does not produce.
5. **The freeze/abandonment gap is architecturally questionable to close now.**
   ADR-043 *retired* the ui-state freeze/thaw + silent-reauth subsystem
   (auth-proxy owns the token lifecycle, ADR-016). ADR-044 states ChatApp's
   `connectivity` region is built "injectable + fakeable + standalone" and "does
   not re-ratify a live freeze path" — whether it is *ever wired live* is deferred.
   The orchestrator's freeze/thaw is acceptance-only (gated behind the
   closed-by-default `KNOB.expireToken`). So building **new** freeze-window /
   buffer-cap / abandonment machinery (PART D's headline gap) invests in a retired
   subsystem and should be reconciled against ADR-043 in Phase 4b, not bolted on
   now.
6. **Therefore: land this doc (Step 0). Stage wire+delete as Phase 4b** (§5). A
   clean, additive, analysis-only landing + a precise staging plan is the
   PART H success outcome; a half-migrated live app where some wire paths hit
   ChatApp and others 404/hit the orchestrator would be a failure.

---

## 1. C0a — Full app assembly (verified in code)

### 1.1 The live entrypoint

| Fact | Evidence |
|---|---|
| Production app = `buildProductionApp()` → `buildSessionOnboardingApp({eventLog, config})` | `ui-state/index.ts:146-153` |
| It mounts **only** `/flow/session-onboarding` + `/flow/login-and-org-setup` (same router instance) | `ui-state/index.ts:119-131` |
| The live `FlowOrchestrator` is built with **no** project/session deps → auth_ready / project_ready spawn hooks are no-ops | `ui-state/index.ts:82-87`; `orchestrator.ts:73-81` ("Optional — when absent, the … spawn hook becomes a no-op") |
| Runtime = `npx tsx index.ts`; image copies only `index.ts` + `lib/` | `ui-state/Dockerfile:33-42` |
| `index.old.ts` (full 3-router composition) is excluded from `tsc` | `tsconfig.json` `exclude: ["…","**/*.old.ts","**/*.old.test.ts"]` |
| `index.old.ts` imports a **deleted** dir | `index.old.ts:44-45,52,64` import `./lib/machines/login-and-org-setup/…`; `ls lib/machines` → only `chat-app, project-context, session-chat, session-onboarding` |

**Conclusion:** the live ui-state is a **session-onboarding-only** service. The
per-machine routers for project-context (`lib/machines/project-context/router.ts`)
and session-chat (`lib/machines/session-chat/router.ts`) exist in the tree but are
mounted by **nothing live** — only by the dead `index.old.ts`.

### 1.2 The wire-routes each per-machine router carries (when mounted)

Every per-machine router mounts the same shape (`flow-router.ts`
`mountUniformFlowRoutes` + its own begin/event/open-deep-link):

```
POST .../begin            POST .../event            POST .../open-deep-link
POST .../freeze           POST .../thaw             GET  .../projection
GET  .../projection/stream  (SSE)
```

`/freeze` + `/thaw` are gated behind the closed-by-default `KNOB.expireToken`
failure-simulation knob (`flow-router.ts:103-117`) — acceptance-only, never a
production path.

### 1.3 What the FE + auth-proxy actually consume (the FROZEN wire contract)

| Consumer | Call | Path |
|---|---|---|
| FE `root.tsx:95,112` | `getProjection("login-and-org-setup")` + `getProjection(PROJECT_FLOW_MACHINE)` | `GET /ui-state/flow/{login-and-org-setup,project-and-chat-session-management}/projection` |
| FE `projects.tsx:38` | `getProjection(PROJECT_FLOW_MACHINE)` | `GET …/project-and-chat-session-management/projection` |
| FE `sessions.tsx:49-50` | `getProjection(PROJECT_FLOW_MACHINE)` + `getProjection(SESSION_CHAT_MACHINE)` | `GET …/{project-and-chat-session-management,session-chat}/projection` |
| FE `chat.tsx:88,97` | `openProjectDeepLink(...)` + `getProjection(SESSION_CHAT_MACHINE)` | `POST …/project-and-chat-session-management/open-deep-link` (intent-shaped) + `GET …/session-chat/projection` |
| FE `project-detail.tsx:71` | `openProjectDeepLink(...)` | `POST …/project-and-chat-session-management/open-deep-link` (intent-shaped) |
| auth-proxy `app.ts:192,269,305-365` | proxies `/ui-state/*` (strips prefix) + KPI-sniffs the response envelope | reads `{state, request_id, context:{underlying_cause_tag, silent_reauth_ok}}` on every `/ui-state/flow/*` response |

Notes that NARROW the live-critical surface:
- The FE client (`ui-state-client.ts`) exposes `getProjection`, `postEvent`,
  `openProjectDeepLink` — **no `begin`**. The live FE never calls `/begin`; it is
  acceptance-harness / dev-compose only (`project-context/router.ts:103`,
  `session-chat/router.ts:83`, both `force_restart:true` idempotent).
- `postEvent` is **defined but called by no FE loader** (grep: only its definition
  in `ui-state-client.ts:89`). project/chat `/event` is acceptance-harness driven.
- `/projection/stream` (SSE) is substrate only — **no FE consumer** in
  `frontend/app/`.
- `openProjectDeepLink` sends `intent_*` fields → the **intent-shaped** deep-link
  branch (`project-context/router.ts:267-309`), which forwards an `open_deep_link`
  event to the project-context actor. The **legacy route-shaped** branch
  (`appendDeepLinkEvents`) is acceptance-harness only.

**Implication for the wire swap:** the FE-critical contract is essentially **three
projection reads + one intent-shaped deep-link**, all of which `deriveProjection`
already produces from a ChatApp snapshot for the happy / freeze / switch / rejected
states (proven byte-stable by `derive-projection.contract.test.ts`). The harder
surface (full `/event` vocabulary, `/begin` idempotency, freeze/thaw, legacy
deep-link, abandonment emission) is **acceptance-harness territory** — important for
subsuming the orchestrator's *tests*, but not for the live FE.

---

## 2. C0b — Gap inventory (orchestrator behavior vs. ChatApp)

Legend — **Status:** ✅ covered by ChatApp/derive today · ➕ additive (closeable
without the wire swap) · 🔗 entangled with the wire swap (do in 4b) · ⚠️ premature /
in tension with ADRs · ✔︎ already satisfied by ChatApp's shape.

| # | Behavior (orchestrator) | Evidence (orchestrator) | ChatApp status | Class |
|---|---|---|---|---|
| 1 | **Freeze window (5000ms) + buffer cap (16) → abandonment.** `FrozenState.shouldAbandon` (window OR `queued.length>=16`); overflow/timeout → `replay_abandoned` + `*_recoverable_error` (`underlying_cause_tag:"replay_abandoned"`) | `orchestrator.ts:335-373,751-778,1063-1108`; `projection.ts:951-957,609-623` | ChatApp `frozen` region holds + replays with **no window, no cap, no abandonment** (`machine.ts:353-368`) | ⚠️ |
| 2 | **REAUTH_FAILED → login `error_recoverable` + J-002 `error_recoverable`** (silent-reauth-failure broadcastThaw "abandoned"); session NOT rejected | `orchestrator.ts:860-865,1063-1106` | ChatApp **REAUTH_FAILED → lifecycle `rejected`** (`machine.ts:361-366`; `integration.test.ts:316-325`) — a **semantic divergence**; the derived login view would mis-report | 🔗⚠️ |
| 3 | **`stale_intent_dropped_after_thaw`** (observability event appended on replay when a replayed intent's target no longer resolves) | `orchestrator.ts:1206-1248`; `projection.ts:933-943` | ChatApp replays held intents but appends **no** stale-intent event; the snapshot-derived view has no stale-intent surface | 🔗 |
| 4 | **Cross-flow FIFO replay order** (`replaySeq`, two-pass THAW across separate per-flow queues) | `orchestrator.ts:1032-1248` | ChatApp uses **one** `held_events` buffer on one actor → naturally FIFO | ✔︎ |
| 5 | **Deep-link — intent-shaped** (`open_deep_link` → project-context re-enters `resolving_initial_scope`, absorbs `deeplink_*` into context) | `project-context/router.ts:267-309`; `project-context/machine.ts:289-301` | project-context child **has** the `open_deep_link` handler → child context carries `deeplink_*` → `deriveProjection` reads it (`derive-projection.ts:281,416`). **Works once `/event`/deep-link is wired to the child.** | 🔗 (mechanism ✅) |
| 6 | **Deep-link — legacy route-shaped** (`appendDeepLinkEvents` → `deep_link_opened`/`scope_access_denied` folded into `active_scope`/`access_denied`/`scope_reconciled`) | `session-onboarding/router.ts:302-370`; `project-context/router.ts:311-369`; `session-chat/router.ts:185-252`; `projection.ts` deep-link folds | The snapshot-derived view does **not** read deep-link log events for scope; only the intent-shaped path (via child context) is reproduced. Acceptance-harness only. | 🔗⚠️ |
| 7 | **`switching_project` / `scope_mismatch_terminal` / `access_revoked`** (project switch via `switching_project_intent`) | `orchestrator-switching-project.test.ts`; `project-context/machine.ts` | ChatApp `PROJECT_SWITCH` forwards `switching_project_intent` to project-context (`machine.ts:192-201,311-313`); derive covers `switching_project` (`contract.test.ts:408-431`). **But** the live `/event` route must map `switching_project_intent` → ChatApp `PROJECT_SWITCH` (vocabulary mapping). | 🔗 (mechanism ✅) |
| 8 | **`switching_dataset_context` / `dataset_attached` / `dataset_access_denied`** (US-209) | `orchestrator-switching-dataset-context.test.ts`; `session-chat/machine.ts` | session-chat child handles these; but ChatApp has **no `/event` forwarding** for `dataset_resolved_by_agent` / `dataset_picked_directly` (not in `ChatUserIntent`) | 🔗 |
| 9 | **Full `/event` vocabulary forwarding** to the active child (create_project_submitted, switching_project_intent, first_message_sent, dataset_*, retry_clicked, back_to_projects_clicked, open_deep_link, …), held while frozen | per-machine `router.ts` `/event` handlers; child machines' event unions | ChatApp forwards only `ChatUserIntent` = `{session_clicked,new_session_clicked,refresh_session_list}` + `PROJECT_SWITCH` (`types.ts:103-121`, `machine.ts:202-214`). **The single biggest additive gap.** | 🔗 |
| 10 | **Freeze-during-in-flight-invoke** (child's `freeze` side-state STOPS the in-flight invoke; mid-flight 401 discarded; re-fires on THAW). Acceptance slow-switch/slow-resume knobs exercise it | `project-context/machine.ts:285-289,945+`; `session-chat/machine.ts:445-446,955+`; `flow-router.ts` knobs | ChatApp's parent-hold design **does not pause** the child — an in-flight child invoke keeps running through TOKEN_EXPIRED. Behavioral delta (review §3 acknowledges). | 🔗⚠️ |
| 11 | **`/begin` idempotency / `force_restart`** (spawn-or-reset one flow) | `orchestrator.ts:480-668`; routers `force_restart:true` | Becomes "create the ChatApp actor if absent; force_restart resets" at the actor-per-principal registry — **wiring concern** | 🔗 |
| 12 | **Failure-sim harness knobs** (`__force_failure__`, force-create-project/session-failure, slow-switch/slow-resume, force-list-sessions, force_reissue_failures) gated at the router edge | per-machine `router.ts`; `index.test.ts` Slices 2-4 | Must still thread through ChatApp's input/events at the new routers — **wiring concern** | 🔗 |
| 13 | **Wire-name aliasing** (login-and-org-setup→session-onboarding; project-and-chat-session-management→project-context) | `orchestrator.ts:243-248`; `orchestrator-legacy-alias.test.ts` | Handled in `derive-projection.ts:63-69` `WIRE_TO_CHILD`; the new event/begin routes must canonicalize too | ✅ (read) / 🔗 (write) |
| 14 | **Happy login→project→chat, project switch (idempotent), session_rejected, freeze overlay, session_active, needs_org, error_recoverable** | orchestrator + integration tests | **All covered** by `integration.test.ts` + `derive-projection.contract.test.ts` (byte-stable golden vs `buildProjection`) | ✅ |
| 15 | **Per-machine projection read** (`GET /projection`) | `flow-router.ts:167-177`; `orchestrator.ts:1315-1329` | `deriveProjection(snapshot, wireMachine, bookkeepingFromLog(log))` reproduces it byte-stable | ✅ (needs wiring to the live route) |

### 2.1 Orchestrator test-behavior inventory (the characterization baseline)

The six `orchestrator*.test.ts` files drive the `FlowOrchestrator` class directly
(not over HTTP). They are the partial characterization net Phase 4b must re-cover
before deleting. Key pinned behaviors:

- `orchestrator.test.ts` — freeze marks every non-origin actor frozen (origin
  skipped); thaw clears; queue 3 intents → replay on thaw (buffer 3→0); **16 events
  buffer, 17th abandons** (`isAbandoned`); **5001ms window elapses → late event
  dropped + abandoned** (`vi.advanceTimersByTimeAsync(5_001)`); returning-user
  `verifying→ready` fires `auth_ready` carrying org_id + first_name (spawns
  project-context).
- `orchestrator-freeze-replay.test.ts` — queued `switching_project_intent` replays
  to `project_selected` on the switched-to project; projection `state`,
  `active_scope.project_id`, and `sequence_id` are replay-transparent.
- `orchestrator-frozen-state.test.ts` — `FrozenState.shouldAbandon` boundary:
  window-elapsed → true; `queued.length>=16` → true; fresh → false; 15 false / 16
  true (the `>=` boundary).
- `orchestrator-switching-project.test.ts` — `switching_project_intent` →
  `project_selected` on new project (`switching_project_started` + `project_switched`
  appended); revoked switch → `scope_mismatch_terminal` (`underlying_cause_tag:
  "access_revoked"`).
- `orchestrator-switching-dataset-context.test.ts` — `dataset_resolved_by_agent` →
  `session_active` with `active_scope.resource_*` set (`switching_dataset_context_started`
  + `dataset_attached`); cross-tenant `dataset_picked_directly` → back to
  `session_active`, prior resource preserved, `underlying_cause_tag:
  "dataset_access_denied"`, no `dataset_attached`.
- `orchestrator-legacy-alias.test.ts` — a `login-and-org-setup:`-prefixed flow keys
  the actor map verbatim, begins in `needs_org`, and resolves to the
  session-onboarding strategy on `/event` (`org_created` appended, `ready`).

Constants pinned: `FREEZE_WINDOW_MS = 5000`, `REPLAY_BUFFER_CAP = 16`.

---

## 3. Landing decision (PART H)

**Decision: take the PART H safety valve. Land this Step-0 analysis (docs-only,
additive, zero live change). Stage the wire-swap + orchestrator deletion as
Phase 4b.**

Why the full wire+delete cannot land safely-green in one MR:

1. **Gap #9 (full `/event` vocabulary) is a large additive design.** ChatApp today
   forwards a 3-member intent union; the live wire `/event` surface for project/chat
   is ~10+ event types that must route to the active child, be held while frozen,
   and replay on thaw. This is non-trivial machine + type + test work, not a
   mechanical re-point.
2. **Gap #2 (REAUTH_FAILED divergence) and #10 (freeze-during-invoke) are semantic
   reconciliations**, not re-wiring — and they interact with the derived view.
3. **The only app-level regression net for live behavior (`index.test.ts`) tests
   session-onboarding in isolation** with a narrow mock `fetch` tuned to the WorkOS
   re-verify + org endpoints only. Wiring ChatApp couples onboarding → downstream
   project-context/session-chat children, which fire backend calls the test's mock
   does not anticipate the moment onboarding reaches `ready`. Keeping `index.test.ts`
   green through the swap needs careful composition + bounded-settle handling — real
   contract risk that warrants its own focused MR.
4. **The freeze/abandonment gap (#1, also #6, #10) is in tension with ADR-043/044.**
   ADR-043 retired the ui-state freeze/thaw subsystem (auth-proxy owns the token
   lifecycle); ADR-044 leaves ChatApp's `connectivity` wiring deferred and "does not
   re-ratify a live freeze path." Building new abandonment machinery now would invest
   in a retired subsystem. This must be **reconciled against ADR-043 first** in 4b
   (likely: the freeze region stays inert/fakeable and abandonment parity is only
   needed if/when the acceptance freeze family is retargeted — possibly never).

What is already DONE and de-risks 4b (no rework needed):
- The byte-stable derived view (`derive-projection.ts`) for all live-critical
  states (happy, needs_org, error_recoverable, switching_project, session_active,
  freeze overlay, session_rejected) — proven against the `buildProjection` oracle
  (`derive-projection.contract.test.ts`).
- Snapshot persistence + R3 self-heal (`snapshot.ts`,
  `chatapp-snapshot-store.ts`).
- Real-children choreography (`integration.test.ts`).
- Wire-name alias resolution on the read path (`WIRE_TO_CHILD`).

Why NOT to land any of the gap-closures additively now:
- #1/#2/#6/#10 are freeze-related → premature per ADR-043/044 (see above).
- #4/#13(read) are already satisfied.
- #5/#7 mechanisms exist; only the wiring is missing.
- #9/#11/#12 require the wiring context to validate (no app-level harness exists for
  project/chat until the swap lands).

There is therefore **no gap that is simultaneously additive-safe, architecturally
sound, and decoupled from the wire swap.** The honest additive landing is this
analysis. (This is the explicit PART H success outcome: "A clean, green, partial,
ADDITIVE landing + a handoff plan is a SUCCESS.")

---

## 4. Frozen wire contract (do-not-break, for Phase 4b)

The wired ChatApp app MUST serve and reproduce byte-for-byte:

```
GET  /flow/session-onboarding/projection                       (canonical)
GET  /flow/login-and-org-setup/projection                      (alias → session-onboarding slice)
GET  /flow/project-and-chat-session-management/projection      (→ project-context slice)
GET  /flow/project-context/projection                          (canonical alias)
GET  /flow/session-chat/projection                             (→ session-chat slice)
POST /flow/project-and-chat-session-management/open-deep-link   (intent-shaped → project-context child)
POST /flow/{session-onboarding,login-and-org-setup}/begin       (acceptance/dev)
POST /flow/{any}/event                                          (acceptance/dev; full vocabulary)
POST /flow/{any}/{freeze,thaw}                                  (acceptance-only, KNOB.expireToken)
GET  /flow/{any}/projection/stream                              (SSE substrate; no live FE consumer)
```

`FlowProjection` shape (frozen, ADR-027): `{flow_id, state, context, active_scope,
sequence_id, last_event_at, request_id}` — `flow_id` synthesized server-side as
`{wireMachine}:{principal}`; the alias name is kept verbatim in the key. The
auth-proxy KPI sniffer reads literal `state` strings (`"ready"`,
`"error_recoverable"`) + `context.underlying_cause_tag` + `context.silent_reauth_ok`
— do not perturb these.

---

## 5. Phase 4b staging plan (the wire+delete, as a sequence of safe MRs)

Each step below is a separate atomic landing on a fresh branch; submit each green.
The ordering keeps the live app consistent at every step (PART H: never a state
where some wire paths hit ChatApp and others hit the orchestrator).

**4b-0 — Reconcile the freeze region against ADR-043 (DECISION, no/low code).**
Decide whether ChatApp's `connectivity` region is wired live at all. Per ADR-043 the
default is **leave it inert** (auth-proxy owns the token lifecycle). If inert:
gaps #1/#2/#6/#10 are **out of scope for the live swap** — the acceptance freeze
family (`/freeze`,`/thaw`, slow-switch/slow-resume knobs, `orchestrator-freeze-*`
tests) is retired *with* the orchestrator, not re-implemented in ChatApp. Record the
decision in ADR-044 / a short ADR amendment. **This single decision removes the
largest and riskiest gaps from the swap.**

**4b-1 — Expand ChatApp's `/event` forwarding vocabulary (gap #9, additive).**
Generalize `ChatUserIntent` (or add a generic "forward to active child" event) to
the full project-context + session-chat event surface, held while frozen (if the
region is wired) / forwarded live otherwise. Test at the machine + integration level
against the existing child machines. Extend `derive-projection` golden tests for any
newly reachable states (`creating_project`, `no_projects`,
`switching_dataset_context`, `session_active` with resource, `scope_mismatch_terminal`,
`session_welcome`). ADDITIVE — ChatApp still not live.

**4b-2 — App-level characterization net (PART E), against a NEW wired test app.**
Build a `buildChatAppApp()` test harness (in-process Hono, noop event-log, mock
fetch / `fromPromise` child fakes) and write app-level tests asserting the projection
sequence for: happy login→project→chat; project switch; session_rejected;
intent-shaped deep-link (scope resolved + denied); `/begin force_restart`;
needs_org→ready. (Freeze/thaw/abandonment cases only if 4b-0 keeps the region live.)
Keep `index.test.ts` as the session-onboarding regression net — it must pass against
the new app. ADDITIVE (new app built beside the live one).

**4b-3 — Swap the live composition root (the risky cut).** Rename/replace
`buildSessionOnboardingApp` → `buildChatAppApp`: construct `ChatAppDeps` (project +
session resolver actors from `config` + `requestClient`), `selectChatAppSnapshotStore`,
an **actor-per-principal registry** (create / lookup / rehydrate-from-snapshot /
dispose), and keep the event log appended for SSE/audit + bookkeeping. Mount **every**
wire path in §4. Map each route:
  - `POST …/{session-onboarding,login-and-org-setup}/begin` → create+start the
    principal's ChatApp actor with the begin envelope; persist at settle; return
    derived login projection.
  - `POST …/{project-context,session-chat}/begin` → ensure-actor-exists; honor
    force_restart.
  - `POST …/{any}/event` → canonicalize wire name → map to ChatApp event / forward
    to active child; persist at settle; return derived projection.
  - `GET …/{machine}/projection` → `deriveProjection(snapshot, wireMachine,
    bookkeepingFromLog(log))`.
  - `POST …/project-and-chat-session-management/open-deep-link` (intent-shaped) →
    forward `open_deep_link` to project-context child.
  - `/freeze`,`/thaw`, legacy route-shaped deep-link → per the 4b-0 decision.
  Prove `index.test.ts` + 4b-2 green. **Carefully** handle the onboarding→downstream
  coupling (bounded settle; the test mock must tolerate downstream child calls, or
  the begin/event handlers await only the relevant slice). This is the make-or-break
  MR; if it cannot land green, do NOT submit a half-migrated app.

**4b-4 — Delete the orchestrator stack (only when 4b-3 is green).** Remove
`orchestrator.ts`, `orchestrator-harvester.ts`, `wait-for-settled-state.ts`, the
three `strategy.ts`, the dead bits of `flow-router.ts`
(`mountUniformFlowRoutes`/`freezeThawHandler` if replaced; KEEP `requestIdMiddleware`
+ `resultToJson` if still used), `FlowActorRegistry`/`FrozenState`/
`FLOW_STRATEGY_REGISTRY`/`MACHINE_NAME_ALIASES` (move any still-needed alias map to a
small shared module — note `derive-projection.ts` already has `WIRE_TO_CHILD`).
Delete `orchestrator*.test.ts` **only** because 4b-1/4b-2 re-cover their behavior;
for any behavior not yet re-covered (e.g. the acceptance freeze family if retired in
4b-0, or stale-intent #3), ADD coverage or record its retirement first (Iron-Rule-safe
path). Also retire `index.old.ts` / `index.old.test.ts`.

**4b-5 (DEAD LAST) — Remove the children's `on.FREEZE`/`freeze`/`THAW` handlers**
(`project-context/machine.ts`, `session-chat/machine.ts`) — only after the
parent-pause (or its retirement per 4b-0) is proven. Per ADR-043 these are likely
retired wholesale. Update the child `machine.test.ts` accordingly. If unsure, leave
them and flag — a leftover freeze handler is harmless; a premature deletion is not.

### Risk register for 4b
- **R-A (highest):** `index.test.ts` regression through 4b-3's onboarding→downstream
  coupling. Mitigate: bounded per-slice settle; tolerant test mock; derive login from
  the retained `onboarding_result` (already implemented).
- **R-B:** derived-view byte-drift for newly reachable states. Mitigate: keep the
  `expect(derive).toEqual(buildProjection(equivalentLog))` oracle pattern for every
  new golden (self-checking byte-stability).
- **R-C:** freeze-region scope creep. Mitigate: settle 4b-0 first; default to inert
  per ADR-043.
- **R-D:** acceptance-suite breakage (project/chat `/begin`,`/event`,`/open-deep-link`,
  `/freeze`,`/thaw`). Run `tests/acceptance/*` for the project/chat features against
  4b-3 before submission.

---

## 6. What landed in this MR vs. deferred

**Landed (this MR, additive, docs-only):** this gap analysis + staging plan.
**Deferred to Phase 4b:** all of §5 (gap-closing #1-#13, the live wire swap, the
orchestrator deletion, the child freeze-handler removal). No live behavior changed;
no code touched.
