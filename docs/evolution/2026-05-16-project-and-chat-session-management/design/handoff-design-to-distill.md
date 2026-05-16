# DESIGN → DISTILL Handoff — `project-and-chat-session-management` (J-002)

> **Wave**: DESIGN → DISTILL (with SRP amendment 2026-05-13)
> **Date (original)**: 2026-05-13
> **Date (SRP amendment)**: 2026-05-13
> **From**: nw-solution-architect (J-002 DESIGN wave + amendment)
> **To**: nw-acceptance-designer (J-002 DISTILL wave)
> **Status**: All four DESIGN artifacts shipped + SRP amendment applied. All blocking OQs resolved (OQ-J002-1 in DWD-2; OQ-J002-6 in DWD-7; machine split in DWD-13). No new ADR proposed. **Awaiting nw-solution-architect-reviewer pass on the amendment** before this handoff is binding.

## SRP amendment addendum (DWD-13) — what changed for DISTILL

Per the SRP review (`./review-by-software-crafter-srp.md`) the original single-machine J-002 is split into **two sibling machines** under the ADR-028 actor model:

- **`project-context`** — 8 states; owns project-resolution / project-creation / project-switching / scope-mismatch + freeze + error_recoverable.
- **`session-chat`** — 9 states (including a new `waiting_for_project` initial state); owns session-list / resume / new-session / active / dataset-switch + freeze + error_recoverable.

**The journey YAML's 14 narrative states are partitioned across the two machines** (per `application-architecture.md` §2 + `c4-diagrams.md` §3 post-amendment). No journey state is added or removed (the new `waiting_for_project` is an XState-implementation-level state with no user-visible surface). **No user story acceptance criterion is amended.** The DISTILL scenarios in `roadmap.json` remain valid; their projection-level assertions continue to work against per-machine projections via the harness composer.

### What DISTILL needs to know about the split

1. **The scenario→file mapping below identifies which machine owns each scenario's load-bearing assertion** so the harness call routes correctly.
2. **No scenario is invalidated.** The legacy `harness.j002.assert_state(name)` continues to work (it inspects BOTH projections and asserts the state appears in EITHER). Tests authored before the split need no body changes.
3. **A few harness extensions are needed** for per-machine assertions (see "Harness extensions" below). The existing 12 harness operations remain.
4. **The MR-1.5 refactor MR (NEW per DWD-13)** lands BETWEEN MR-1 (shipped) and MR-2. The MR-1.5 worker is responsible for the split; DISTILL does NOT modify acceptance tests for MR-1.5 — they pass verbatim against the post-split code.

### Scenario-to-machine mapping addendum

Annotating each MR's scenarios with the load-bearing machine assertion:

| MR | Scenario file | Scenario | Load-bearing machine | Harness call (suggested) |
|---|---|---|---|---|
| MR-1 | test_us201 (all) | All 5 scenarios | project-context | `harness.j002.assert_project_context_state(name)` |
| MR-1 | test_us202 (all) | All 5 scenarios | project-context | `harness.j002.assert_project_context_state(name)` |
| MR-1 | test_us204 (all) | All 6 scenarios | project-context (resolves scope, surfaces scope_mismatch_terminal) | `harness.j002.assert_project_context_state(name)` |
| MR-1 | test_journey_invariants | IC-J002-1 (J-001 → project-context org_id parity) | project-context (consumer of j001_ready) | `harness.j002.assert_scope({org_id})` via composer |
| MR-1 | test_journey_invariants | IC-J002-2 (project_selected has non-null project_id) | project-context | `harness.j002.assert_project_context_state("project_selected")` + `harness.j002.assert_scope({project_id})` |
| MR-2 | test_us203 (all) | All 6 scenarios | session-chat (session list) | `harness.j002.assert_session_chat_state(name)` |
| MR-2 | test_us205 (all) | All 5 scenarios | session-chat (resume + dataset restore) | `harness.j002.assert_session_chat_state(name)` |
| MR-2 | test_journey_invariants | IC-J002-3 (resume materializes atomically) | session-chat (`resuming_session → session_active`) | `harness.j002.assert_session_chat_state("session_active")` + `harness.j002.assert_scope({resource_*})` |
| MR-3 | test_us206 (all) | All 6 scenarios | session-chat (new-session lifecycle) | `harness.j002.assert_session_chat_state(name)` |
| MR-4 | test_us207 (all) | All 5 scenarios | project-context for the SWITCH transition; session-chat for the INVALIDATION assertion | Composed: `harness.j002.assert_project_context_state("switching_project")` then `harness.j002.assert_session_chat_state("loading_session_list")` then `assert_scope({project_id: new})` |
| MR-4 | test_us208 (all) | All 6 scenarios | (agent boundary — neither J-002 machine; agent receives composed scope) | Existing `assert_agent_received_scope(turn_index)` |
| MR-4 | test_journey_invariants | IC-J002-4 (switching_project invalidates session_id + resource_*) | Both — atomicity is a cross-machine property | Composed scope read pre/post switch: `assert_scope({project_id: old, session_id: null AFTER}, {project_id: new, session_id: null AFTER})` |
| MR-4 | test_journey_invariants | IC-J002-7 (every chat turn carries X-Active-Scope) | session-chat (chat-emitting states live here) | `harness.j002.assert_agent_received_scope_for_chat_turns_from(session-chat states)` |
| MR-5 | test_us209 (all) | All 6 scenarios | session-chat | `harness.j002.assert_session_chat_state(name)` |
| MR-5 | test_journey_invariants | IC-J002-5 (dataset_resolved_by_agent → exactly one scope update) | session-chat | `harness.j002.assert_session_chat_state("session_active")` + scope assertion |
| MR-6 | test_us210 (all) | All 6 scenarios | both (FREEZE broadcasts to both; each restores independently) | `harness.j002.assert_project_context_state("freeze")` AND `harness.j002.assert_session_chat_state("freeze")`; THAW asserts both restore |
| MR-6 | test_journey_invariants | IC-J002-6 (FREEZE → mutations paused → THAW replays) | both | Same — broadcast invariant; each machine's replay buffer drained independently |

**Rule of thumb**: if the scenario asserts something happening "in" project resolution, project creation, project switching, or scope-mismatch terminal → it's project-context's assertion. If it asserts anything about session lists, transcripts, dataset attach, or chat-emitting states → it's session-chat's assertion. FREEZE/THAW is cross-cutting. The agent boundary (US-208) is neither machine — the agent reads from a composed header.

### Harness extensions (DWD-13 §RD13-3 mitigation)

Add to `harness.j002.*`:

```ts
// Per-machine state assertions
await harness.j002.assert_project_context_state(expectedState: ProjectContextState);
await harness.j002.assert_session_chat_state(expectedState: SessionChatState);
await harness.j002.assert_state_in(machine: "project-context" | "session-chat", expectedState: string);

// Legacy compatibility (continues to work; reads both projections)
await harness.j002.assert_state(expectedState: string);  // Returns true if state matches EITHER projection.

// Composed-scope read (already in the original 12-operation list)
await harness.j002.assert_scope({ org_id?, project_id?, resource_type?, resource_id? });
//   Reads project-context's projection for org_id + project_id; session-chat's for resource_*.
```

**Per-machine event-stream assertions**: emit assertions remain by event name (e.g., `assert_event_emitted("project_selected")` still works — the event lives in project-context's event log; the harness looks it up via the per-machine flow_id automatically).

### Roadmap.json update guidance

`docs/feature/project-and-chat-session-management/distill/roadmap.json` (already shipped at MR-time per the binding inputs) need not be rewritten. The `files_changed_estimate` list for each step is now slightly inaccurate — `ui-state/lib/machines/project-and-chat-session-management.ts` is replaced by `project-context.ts` + `session-chat.ts`; the orchestrator gains a second broadcast hook. DISTILL may either:

- (a) Update `roadmap.json` in a follow-up DISTILL revisit MR with the post-DWD-13 file paths and per-machine routing notes, OR
- (b) Leave `roadmap.json` as-is; the DELIVER agents (per `nw-deliver` and `nw-execute`) read both the roadmap AND this handoff addendum AND the post-amendment `application-architecture.md` §9 (which IS updated to show MR-1.5 + per-machine touch).

The author recommends (b): the roadmap is mostly stable; the handoff addendum + app-arch §9 are the authoritative routing source for the DELIVER worker. A DISTILL revisit is out of scope for this DESIGN amendment.

### What is NOT changed by the SRP amendment for DISTILL

- The 65-scenario scope (per `roadmap.json` `totals.scenarios_pytest`).
- The 6-MR DELIVER plan (MR-1.5 is INSERTED as a refactor — it lands BETWEEN MR-1 and MR-2 and ships no new behavior, so DISTILL has nothing to write for it).
- The Iron Rule (NEVER modify a failing test to make it pass).
- The mandate compliance evidence (CM-A driving port; CM-B business language; CM-C walking skeletons; CM-D pure function extraction).
- The adapter coverage table.
- All BDD scenario step glue.

### Migration concerns for MR-1.5 (per reviewer R1)

MR-1's event log lives at `ui-state:project-and-chat-session-management:<principal_id>:events`. Post-split the events fan out across `ui-state:project-context:<principal_id>:events` AND `ui-state:session-chat:<principal_id>:events`. The MR-1.5 implementer chooses one of:

1. **One-time double-write migration** (recommended for production-like environments): for each principal in the old prefix, run `XRANGE` on the old key → classify each event by its target machine via the per-machine event taxonomy in `application-architecture.md` §7.3 → `XADD` to the appropriate new key. Idempotent on re-runs (the `event_id` discriminates duplicates). Drop the old key when both new keys have caught up.
2. **Lazy-migration on first read** (recommended for dev / compose environments): on the first projection read after MR-1.5 ships, if both new keys are empty AND the old key exists, run the classification + double-write inline. Subsequent reads see the migrated state.

Either approach is consistent with the projection-builder's pure-fold semantics — the events themselves don't change shape; only their key location does. MR-1.5's MR description must surface which path was taken so DEVOPS knows whether to expect a one-time migration job or lazy-on-read latency on the first post-deploy projection fetch.

**This is operational hygiene, not architectural** — the amendment's logic is unaffected. The DISTILL acceptance tests are unaffected either way (they read projections, not Redis keys directly).

### `waiting_for_project` observability note (per reviewer R2)

During the brief `waiting_for_project` dwell (typically <10 ms between orchestrator broadcast and machine transition), the FE renders from project-context's projection only — no session-list UI appears until session-chat enters `loading_session_list`. The projection-compose layer in `uiStateClient` naturally handles this: if session-chat's projection doesn't exist yet (actor not yet spawned, or 404 from the projection-fetch HTTP), the composer defaults session-chat context fields to null. **The harness needs NO special `waiting_for_project` assertion path** — acceptance tests targeting downstream session-chat states naturally wait for the transition before reading session-chat's projection.

**The FE composer's null-handling is itself a DELIVER detail** — the composer should treat "session-chat projection 404 / actor-not-yet-spawned" identically to "session-chat in `waiting_for_project`" — both produce a `view` shape where `view.sessionChat` is null. The MR-1.5 implementer should write a unit test asserting this equivalence so the FE's render logic remains unambiguous.

---

---

## TL;DR for the acceptance-designer

You inherit:

- A **binding 14-state J-002 machine state-chart** mapped to XState v5 idioms (`application-architecture.md` §2).
- **Two resolved open questions** that were DELIVER-blocking: session-metadata storage shape (Option A — column on session row) and the stale-intent filter rule.
- **A 6-slice DELIVER plan = 6 MRs** with explicit slice-boundary contracts, dependencies, and reversibility shapes.
- **An IMMUTABLE journey YAML** at `discuss/journey-project-and-chat-session-management.yaml` carrying 12 named states, 7 integration checkpoints (IC-J002-1..IC-J002-7), 7 failure modes, and a TS-harness operations contract.
- **10 user stories US-201..US-210** with 5-6 UAT scenarios each (~55 Gherkin scenarios already drafted).
- **6 outcome KPIs** with instrumentation handoff for DEVOPS.

You are responsible for translating the 55+ Gherkin scenarios into a runnable pytest-bdd acceptance suite, with a **per-slice file shape** mirroring J-001's pattern:

```
tests/acceptance/project-and-chat-session-management/
├── pyproject.toml                            # NEW — feature-scoped uv venv, mirrors J-001
├── conftest.py                               # NEW — fixtures, harness imports
├── harness/
│   ├── ts_harness.py                         # NEW — Python wrapper around TS UserFlowHarness
│   ├── dataset_layer_harness.py              # EXTENDED — adds chat_turn_with_scope_header
│   └── fixtures.py                           # NEW — personas (maya-returning, maya-first-time, maya-deep-link)
├── test_us201_first_time_in_org.py
├── test_us202_returning_user_last_used.py
├── test_us203_session_list_recency.py
├── test_us204_cold_deep_link_resolve.py
├── test_us205_session_resume_with_dataset.py
├── test_us206_new_session_lifecycle.py
├── test_us207_project_switching_atomic.py
├── test_us208_agent_scope_contract.py
├── test_us209_dataset_context_switching.py
├── test_us210_freeze_thaw_replay.py
└── test_journey_invariants_j002.py           # Cross-cutting IC-J002-1..IC-J002-7 invariants
```

> **The substrate is already standing up.** ADR-027/028/029/030 + the orchestrator + the projection-builder + the ScopeResolver + the FlowEventLog are all in place. J-002 plugs into them via the orchestrator's new `MachineRegistry` (DWD-8) without modifying the substrate. **DISTILL does NOT need to write acceptance tests for the substrate**; those exist from J-001 (`tests/acceptance/user-flow-state-machines/`). **DISTILL writes J-002-internal scenarios** that exercise the new machine + the agent contract + the cross-machine FREEZE participation.

---

## Endpoints to assert against (non-negotiable contracts)

### 1. UI-state tier — J-002 endpoint family

| Endpoint | Owner | Used by | Slice |
|---|---|---|---|
| `POST /ui-state/flow/project-and-chat-session-management/begin` | UI-State Tier | TS harness (initial spawn); FE root loader (post-`j001_ready` orchestrator broadcast — auto-spawn) | Slice 1 |
| `POST /ui-state/flow/project-and-chat-session-management/event` | UI-State Tier | TS harness + FE loaders / chat-view (all user-action events) | All slices |
| `GET /ui-state/flow/project-and-chat-session-management/projection?flow_id=...` | UI-State Tier | FE loaders, TS harness, acceptance tests | All slices |
| `POST /ui-state/flow/project-and-chat-session-management/open-deep-link` | UI-State Tier | FE deep-link loaders | Slice 1 |
| `GET /ui-state/flow/project-and-chat-session-management/projection/stream` (SSE) | UI-State Tier | FE chat-shell EventSource consumer (cross-tab refresh) | Slice 2 (NEW per DWD-9) |

### 2. Agent — X-Active-Scope contract surface

| Endpoint | Behavior | Slice |
|---|---|---|
| `POST /chat` | Reads `X-Active-Scope` header EXCLUSIVELY (post-sunset); 400 on missing org_id / project_id; 403 on `X-Active-Scope.org_id != X-Org-Id`; one-release fallback to body `project_id` with `scope_header_fallback_used` log + compile-time sunset (per DWD-3) | Slice 4 |

### 3. Backend — `update_session` allowlist surface

| Endpoint | Behavior | Slice |
|---|---|---|
| `PATCH /api/sessions/:id` | Accepts `active_dataset_id` in `update_data` (per DWD-2; allowlist extended in `backend/app/use_cases/session/update_session.py`) | Slice 2 (column added) + Slice 5 (write path lands) |

### 4. ActiveScope schema (inherited from ADR-029 verbatim)

```ts
type ActiveScope = {
  org_id: string;
  project_id: string | null;
  resource_type: "dataset" | "view" | "report" | null;
  resource_id: string | null;
};
```

**ADR-029 invariants 1-5 are the acceptance-test boundary** for the scope contract. J-002 exercises invariants 1, 3, 4, 5 in new call sites.

### 5. FlowProjection envelope (inherited from ADR-027 verbatim; unchanged by J-002 per DWD-9)

```ts
type FlowProjection = {
  flow_id: string;                  // "project-and-chat-session-management:<principal_id>" for J-002
  state: string;                    // one of 14 — see application-architecture.md §2.4
  context: Record<string, unknown>; // J002MachineContext shape — see app-arch §2.1
  active_scope: ActiveScope;
  sequence_id: number;
  last_event_at: string;
  correlation_id: string;
};
```

The TS harness asserts on this shape. The FE renders from this shape. **No FE-internal-only field is acceptable in an acceptance test.**

---

## J-002 flow events (initial vocabulary; extensible per slice)

The acceptance tests assert that these events appear in the projection's underlying log in the expected order:

```
# Slice 1
j002_resolution_started             (resolving_initial_scope entry)
project_selected                    (resolving_initial_scope → project_selected; also switching_project → project_selected)
no_projects_displayed               (resolving_initial_scope → no_projects_empty_state)
project_creation_started            (creating_project entry)
project_created                     (creating_project → project_selected)
scope_mismatch_displayed            (resolving_initial_scope / switching_project → scope_mismatch_terminal)
deep_link_opened                    (existing — extended payload to carry J-002 intent)
scope_reconciled                    (existing — emitted on I5 from active-scope.ts; J-002 exercises it)

# Slice 2
session_list_load_started           (project_selected → loading_session_list entry-action)
session_list_loaded                 (loading_session_list → session_list_visible)
session_list_displayed              (session_list_visible entry)
session_resume_started              (resuming_session entry)
session_resumed                     (resuming_session → session_active)
session_dataset_unavailable         (resuming_session → session_active, graceful-degradation path)
last_used_resolution_degraded       (resolving_initial_scope partial-result per OQ-J002-4)

# Slice 3
session_welcome_displayed           (session_active_no_messages entry)
session_active_reached              (session_active entry, with payload {project_id, session_id, resource_type, resource_id})

# Slice 4
switching_project_started           (switching_project entry)
project_switched                    (switching_project → project_selected; via switchProject invoke onDone)
chat_turn_rejected_missing_scope    (agent middleware emits — observability event for K-J002-5)
scope_header_fallback_used          (agent middleware emits during migration window; observability event)

# Slice 5
switching_dataset_context_started   (switching_dataset_context entry)
dataset_attached                    (switching_dataset_context → session_active happy)
dataset_access_denied               (switching_dataset_context → session_active, graceful-degradation path)

# Slice 6
j002_frozen                         (any non-terminal state → freeze)
j002_thawed                         (freeze → last_live_state)
stale_intent_dropped_after_thaw     (observability event for filtered intents per DWD-7)
replay_abandoned                    (5s timeout in freeze; orchestrator emits)
j002_recoverable_error              (any in-flight state → error_recoverable)
```

These map 1:1 to the journey YAML's `emits` blocks. The DISTILL acceptance tests assert per-scenario that the expected event appears in the projection's log AND the projection's `state` reflects the expected transition target.

---

## MR-by-MR scope mapping (6 slices = 6 MRs)

| MR # | Slice | Stories | Files created | Files extended | Critical-path scenarios DISTILL formalizes |
|---|---|---|---|---|---|
| **MR-1** | **Slice 1** — Walking skeleton | US-201, US-202, US-204 | `ui-state/lib/machines/project-and-chat-session-management.ts` (machine — 5 states subset) | `ui-state/lib/orchestrator.ts` (MachineRegistry refactor per DWD-8); `ui-state/lib/projection.ts` (extend EVENT_HANDLERS for resolution + scope_mismatch); `ui-state/index.ts` (5 J-002 HTTP routes); `frontend/app/root.tsx` (root loader per DWD-4 + §6.1); `frontend/app/routes/project-detail.tsx` (loader); `frontend/app/routes/projects.tsx` (loader); `frontend/app/lib/ui-state-client.ts` (3 new methods — getJ002Projection, postJ002Event, activeScopeHeader) | (1) returning user → last-used; (2) first-time → no_projects_empty_state; (3) cross-tenant deep-link → scope_mismatch_terminal; (4) deep-link with intent_resource carries through; (5) back-to-projects re-enters resolving_initial_scope; (6) TS harness drives all 3 entry shapes |
| **MR-2** | **Slice 2** — Session list + resume | US-203, US-205 | `backend/migrations/versions/009_add_session_active_dataset_id.py` (migration per DWD-2) | machine (+4 states: loading_session_list, session_list_visible, resuming_session, session_active read-only); `projection.ts` (EVENT_HANDLERS for session-list + resume events); `frontend/app/routes/chat.tsx` (loader for `/` index + `/chat/:channelId`); `frontend/app/routes/sessions.tsx` (loader for /sessions); `ui-state/lib/persistence/redis.ts` (subscribe() method for SSE per DWD-9); `ui-state/index.ts` (NEW /projection/stream SSE route); `backend/app/use_cases/session/update_session.py` (allowlist extension) | (1) session list paints with project chip together; (2) resume restores transcript AND dataset chip; (3) session_dataset_unavailable graceful degradation; (4) session_not_found graceful return to session_list_visible; (5) cross-tab session-creation refreshes via SSE; (6) 5-row recent-sessions nav vs 30-row Chats page; (7) TS harness asserts list order + harness.j002.get_transcript |
| **MR-3** | **Slice 3** — New session lifecycle | US-206 | (none — pure machine extension) | machine (+1 state: session_active_no_messages); `projection.ts` (EVENT_HANDLERS for session_welcome_displayed); chat-view FE component (composer-state-preservation contract — no code change required per app-arch §6.4) | (1) new_session_clicked instant-paint with no backend call; (2) first_message_sent eager-creates session AND fire-and-forget title-update; (3) navigation-away leaves NO ghost row; (4) clicking existing session from welcome state transitions to resuming_session (cancels new-session intent); (5) transient create_session failure → error_recoverable; composer text preserved across retry; (6) TS harness drives the lifecycle end-to-end |
| **MR-4** | **Slice 4** — Project switching + agent contract | US-207, US-208 | `agent/lib/chat/scope.ts` (NEW — `extractActiveScope` helper per app-arch §4.1) | machine (+1 state: switching_project); `projection.ts` (EVENT_HANDLERS for switching_project_*); `frontend/app/lib/ui-state-client.ts` (activeScopeHeader called by ALL loader outbound fetches); chat-view FE component (eventSource.close() on projection state === "switching_project"); ESLint rule extension (per DWD-3); `agent/lib/chat/handleChat.ts` (scope refactor — header-only + body fallback + compile-time sunset) | (1) project switch atomically retargets chip+list within 300ms p95; (2) in-flight chat turn cancelled before new loader runs; (3) agent never receives mismatched (project_id, session_id) pair; (4) agent rejects missing org_id → 400; (5) agent rejects missing project_id → 400; (6) agent rejects X-Active-Scope.org_id != X-Org-Id → 403; (7) backward-compat fallback emits scope_header_fallback_used; (8) compile-time sunset check fails build if date passed AND flag still on; (9) TS harness asserts agent received scope per turn |
| **MR-5** | **Slice 5** — Dataset context switching | US-209 | (none) | machine (+1 state: switching_dataset_context; +2 event handlers in session_active); `projection.ts` (EVENT_HANDLERS for switching_dataset_context_*, dataset_attached, dataset_access_denied); chat-view FE component (one-line emit on `data-agent-request` typed-part handler → postJ002Event({type: "dataset_resolved_by_agent", ...})); backend `update_session` path exercised by switchDatasetContext invoke | (1) agent's resolve_dataset → user picks → J-002 switches scope; (2) re-submitted chat turn carries new X-Active-Scope with resource_*; (3) direct dataset selection from list; (4) cross-tenant pick rejected; stays in session_active with prior scope; (5) concurrent dataset picks serialize via XState semantics; most-recent wins; (6) TS harness drives both paths via attach_dataset_via_agent + attach_dataset_directly |
| **MR-6** | **Slice 6** — Cross-machine FREEZE/THAW | US-210 | (none) | machine (top-level on.FREEZE + freeze state + stale-intent guards per DWD-7); `projection.ts` (EVENT_HANDLERS for j002_frozen, j002_thawed, stale_intent_dropped_after_thaw); orchestrator's priorState watcher (already-existing; spawns J-002 actor on J-001 → ready; no further change) | (1) token expiry during resuming_session pauses and replays; (2) token expiry during switching_project replays after thaw; (3) multiple intents queued during freeze replay serially; (4) silent re-auth failure → replay_abandoned → error_recoverable after 5s; (5) freeze during session_active_no_messages preserves welcome view; (6) stale_intent_dropped_after_thaw observability for filtered intents; (7) TS harness can drive freeze/thaw |

### Per-MR sequencing constraints (per `application-architecture.md` §9)

- **MR-1 is the substrate-extension MR.** All later MRs depend on MR-1's machine-registry refactor + the first 5 states.
- **MR-2 is the only MR with a backend migration.** Migration 009 lands and is applied to all environments BEFORE MR-2 enters DELIVER.
- **MR-4 is the only MR with a backward-compat flag.** `SCOPE_HEADER_FALLBACK_ENABLED` defaults TRUE; the sunset date is set at MR-time.
- **MR-5 depends on MR-2's migration AND MR-4's header contract.** Resume's dataset-context restoration (MR-2) and dataset-switching's persistence (MR-5) share the same column.
- **MR-6 depends on MR-1..MR-5.** Without live mutations in 1-5, FREEZE has nothing to freeze.

---

## BDD scenario groups DISTILL formalizes

The 10 user stories' 55+ Gherkin scenarios cluster into **9 acceptance-test files** (one per story) + **1 cross-cutting invariant file** (for IC-J002-1..IC-J002-7). Within each file, scenarios are grouped:

### test_us201_first_time_in_org.py — 5 scenarios

- @happy: first_time_in_org → no_projects_empty_state
- @happy: create_first_project → project_selected
- @validation: empty project name → inline error, no POST
- @recoverable: transient create_project failure → error_recoverable → retry
- @harness: TS harness drives end-to-end

### test_us202_returning_user_last_used.py — 5 scenarios

- @happy: last-used resolution with sessions in multiple projects
- @fallback: projects but no sessions → lexicographic-first project
- @determinism: tie-broken last_active_at → lexicographic-smaller project id
- @degraded: transient list_sessions failure → partial-result resolution + `last_used_resolution_degraded`
- @harness: assert_initial_project

### test_us203_session_list_recency.py — 6 scenarios

- @happy: 4-session list renders sorted DESC
- @ui: recent-sessions nav caps at 5
- @empty: zero-session project → no_sessions_empty_state sub-shape
- @pagination: >30 session project paginates correctly
- @cross_tab: SSE projection-stream refreshes list within 1s
- @harness: get_session_list

### test_us204_cold_deep_link_resolve.py — 6 scenarios

- @happy: cold deep-link resolves before paint <300ms p95
- @cross_tenant: deep-link to other-org project → scope_mismatch_terminal
- @project_not_found: deleted-project deep-link → same panel, different cause tag
- @back: back-to-projects re-enters resolving_initial_scope
- @intent_resource: deep-link with dataset id resolves resource_* on first paint
- @harness: open_deep_link + assert_scope_mismatch

### test_us205_session_resume_with_dataset.py — 5 scenarios

- @happy: resume restores transcript + dataset chip on same first paint
- @no_dataset: resume null-dataset → session_active conversational mode
- @deleted_dataset: stored id 404s → session_active with resource_* null + session_dataset_unavailable event
- @session_not_found: deleted-session click → silently returns to session_list_visible
- @harness: resume_session + get_transcript

### test_us206_new_session_lifecycle.py — 6 scenarios

- @happy: new_session_clicked → session_active_no_messages instantly; no backend call
- @first_message: first_message_sent eager-creates + sets title
- @no_ghost: navigation-away from welcome state leaves NO session row
- @cancel: clicking existing session from welcome state → resuming_session (no row created)
- @recoverable: transient create_session failure → error_recoverable; composer text preserved across retry
- @harness: start_new_session + send_first_message

### test_us207_project_switching_atomic.py — 5 scenarios

- @happy: Q4 → Q3 atomic chip + list paint within 300ms p95
- @sse_cancel: in-flight chat turn SSE closed BEFORE new loader runs; agent never receives mismatched (project_id, session_id)
- @deep_link: deep-link mid-session switches projects
- @revoked: stale link to revoked-access project → scope_mismatch_terminal (NOT project_selected followed by error)
- @harness: switch_project + assert_agent_request_log_no_mismatched

### test_us208_agent_scope_contract.py — 6 scenarios

- @happy: every J-002 chat turn carries X-Active-Scope with org_id + project_id
- @missing_org_id: agent → 400 with named diagnostic
- @missing_project_id: agent → 400
- @org_mismatch: agent → 403
- @fallback: backward-compat fallback emits scope_header_fallback_used
- @harness: assert_agent_received_scope per turn

### test_us209_dataset_context_switching.py — 6 scenarios

- @agent_path: resolve_dataset → user picks → J-002 switches scope + persists
- @resubmit: re-submitted chat turn carries new X-Active-Scope
- @direct_path: direct dataset selection from list
- @cross_tenant: cross-tenant pick rejected; session_active with prior scope unchanged; gutter copy "you don't have access to that dataset"
- @concurrent: rapid-fire picks serialize; most-recent wins
- @harness: attach_dataset_via_agent + attach_dataset_directly + assert_scope

### test_us210_freeze_thaw_replay.py — 6 scenarios

- @resume_replay: token-expiry during resuming_session → freeze → THAW → resuming_session with same correlation_id
- @switch_replay: token-expiry during switching_project replays after thaw
- @multi_intent: multiple intents queued during freeze; FIFO replay; stale-filter drops one with observability event
- @timeout: silent_reauth_failed → 5s timeout → replay_abandoned → error_recoverable
- @no_flicker: freeze during session_active_no_messages preserves welcome view
- @harness: freeze + thaw + assert_no_stale_intents_dropped

### test_journey_invariants_j002.py — 7 invariants

Direct mapping from journey YAML's `integration_checkpoints`:

- **IC-J002-1**: entry from J-001 ready reads active_scope.org_id from J-001 projection (not separate JWT decode)
- **IC-J002-2**: project_selected entry has non-null `active_scope.project_id` AND user authorized (cross-tenant pre-rejected)
- **IC-J002-3**: resuming_session → session_active materializes BOTH transcript AND active_scope.resource_* atomically
- **IC-J002-4**: switching_project entry invalidates session_id + resource_* BEFORE new project's loading_session_list fires; agent receives no further turns from old ChatView
- **IC-J002-5**: dataset_resolved_by_agent → exactly one active_scope.resource_* update via projection; agent's next turn sees the new resource_id; session metadata updated BEFORE next turn dispatched
- **IC-J002-6**: FREEZE pauses all outgoing mutations; intents queue with original correlation_id; THAW replays
- **IC-J002-7**: every J-002-originating chat turn carries X-Active-Scope (org_id + project_id) populated from active_scope; agent rejects missing with 400

These are **property-tagged scenarios** in the J-001 idiom — they assert cross-state invariants that any future J-NNN flow's tests must also satisfy.

**Total scenario count**: ~55 story scenarios + 7 invariant scenarios = **~62 scenarios across 10 test files**.

---

## Test framework recommendation

**Mirror J-001's pattern exactly** (per CLAUDE.md "Acceptance suites (per-feature, run separately…)"):

| Layer | Framework | Why |
|---|---|---|
| Unit tests | Vitest (TS) — `ui-state/test/*.test.ts` | Matches J-001 substrate; pure machine + ScopeResolver unit tests run with no Redis (XState `.provide({ actors: { ... } })` adapter injection) |
| Acceptance | pytest-bdd (Python) — `tests/acceptance/project-and-chat-session-management/` | Matches J-001 pattern. Per-feature `pyproject.toml` + `uv venv`. Run from inside the suite dir per CLAUDE.md: `cd tests/acceptance/project-and-chat-session-management && uv run --no-project pytest` |
| Integration (backend+agent) | pytest (existing `tests/integration/dataset_layer/` shape — DatasetLayerHarness) | EXTENDED for US-208 with `chat_turn_with_scope_header` method (per app-arch §10 + journey YAML's `testing_surface.python_harness`); the existing DatasetLayerHarness Python suite gains one method, not a fork |

**Why per-feature `pyproject.toml`?** Each acceptance suite isolates its deps (TS harness FFI vs DatasetLayerHarness vs pytest-bdd plugins). The `--no-project` flag skips the workspace uv would otherwise infer from cwd. This is the pattern J-001 ratified in DELIVER.

---

## Per-slice walking-skeleton vs milestone shape

| Slice | Walking-skeleton or milestone? | What "demoable" means at slice-end |
|---|---|---|
| **Slice 1** | Walking skeleton | A developer with multiple projects opens a fresh tab, signs in, sees the project chip + (empty-for-Slice-1) session list paint together. A cold deep-link to a cross-tenant project surfaces the named-diagnostic panel within 300ms. |
| **Slice 2** | Milestone (session list populates; resume works) | The chat-shell shows the session list sorted DESC; clicking a prior session resumes transcript + dataset chip. Cross-tab session creation refreshes the list within 1s. |
| **Slice 3** | Milestone (new sessions are real) | "+ New Session" → welcome state → first-message-sent eager-creates a session with the message as title. No ghost rows when user navigates away. |
| **Slice 4** | **Critical-path milestone** (the North Star K-J002-4) | Project switching is atomic; chip + session list paint together within 300ms; no cross-tenant chat-turns. The agent rejects scope-less requests. The migration window flag is active and observability is wired. |
| **Slice 5** | Milestone (dataset stickiness) | Dataset attaches via agent's `resolve_dataset` AND direct selection; the dataset chip survives session resume; cross-tenant pick is rejected gracefully. |
| **Slice 6** | Final milestone (substrate amortization) | Token expiry mid-J-002-mutation is silent — pause + replay + complete. The substrate scales to two machines. |

---

## Known cross-machine coupling that DISTILL must encode

### 1. FREEZE/THAW (Slice 6 — but already exercised in Slices 2-5 via the harness's expire_token knob)

The TS harness's `harness.j001.expire_token()` (inherited from J-001) triggers J-001's `__harness_expire_token__` event → `expired_token` state → orchestrator broadcasts FREEZE. **DISTILL acceptance tests in Slices 2-5 should opportunistically assert** that mid-mutation token expiries are handled (Slice 2's resume should be FREEZE-tolerant by the time Slice 6 ships).

But the **dedicated test coverage lives in Slice 6** (`test_us210_freeze_thaw_replay.py`). The orchestrator's FREEZE broadcast is already deterministic from J-001's DELIVER; DISTILL doesn't need to mock it — the harness drives it directly.

### 2. `active_scope.org_id` inheritance from J-001 (every J-002 state)

J-002's machine context's `org_id` is set on the `j001_ready` event the orchestrator broadcasts (DWD-6). **IC-J002-1 asserts this in `test_journey_invariants_j002.py`** — the J-002 projection's `context.org_id` MUST equal the J-001 projection's `active_scope.org_id` at the same `sequence_id` boundary (i.e., they don't drift after both flows are running).

### 3. The `correlation_id` thread (every transition)

Inherited from J-001's pattern. **IC-J002-1 also asserts** that `correlation_id` threads through every J-002 emit. The journey YAML's `emits` blocks all carry `correlation_id`; the acceptance tests assert the same id appears on the originating user-action AND on every subsequent emit until the transition completes.

### 4. The agent contract (Slice 4 — load-bearing)

`X-Active-Scope` on every outgoing chat turn from J-002 states. **IC-J002-7 asserts this universally**: `test_journey_invariants_j002.py` includes a parameterized scenario over every chat-turn-emitting state (`session_active`, `session_active_no_messages` post-`first_message_sent`) that asserts the agent's request log carries the header.

### 5. Session-list cache invalidation on project switch (Slice 4 — R9)

Per US-207 AC: "Before `loading_session_list` fires for the new project, the FE's TanStack Query cache for `list_sessions(old_project_id)` is invalidated." **DISTILL's acceptance test asserts at the projection level** — no Q4 session ever appears in Q3's projection after the switch. The cache-invalidation mechanism (DWD-11: RRv7 loader re-run for framework-mode routes; explicit `invalidateQueries` for legacy library-mode consumers) is a FE-level detail; the acceptance test is correct at the projection boundary regardless.

---

## Acceptance-test seeds — Gherkin scenarios per story

The DISCUSS wave embedded Gherkin per story (US-{201..210}.md §"UAT Scenarios"). DISTILL translates these into pytest-bdd `.feature` files (or inline `@scenario` decorators if the team prefers Python-native). The journey YAML's embedded Gherkin (`journey-project-and-chat-session-management.feature`) provides the journey-level scenarios; the per-story Gherkin provides the per-state scenarios.

**The translation rule** (carried verbatim from J-001 DESIGN → DISTILL handoff):

> Every "Then J-002 transitions through X to Y" Gherkin step asserts on the projection's `state` field — NOT on internal XState state-event ordering. The harness's `assert_state(name)` reads from the same projection endpoint the FE consumes. Tests that bypass the projection and inspect machine internals are forbidden by ADR-027's single-source-of-truth invariant.

---

## TS UserFlowHarness extensions (J-002 namespace)

Per the journey YAML's `testing_surface.ts_harness.operations` list, the harness gains 12 new operations under `harness.j002.*`:

```ts
await harness.j002.open_project(project_id);              // switching_project or initial selection
await harness.j002.open_deep_link({project_id, session_id?, dataset_id?});
await harness.j002.resume_session(session_id);
await harness.j002.start_new_session();
await harness.j002.send_first_message(content);
await harness.j002.switch_project(project_name_or_id);
await harness.j002.attach_dataset_via_agent(dataset_name);
await harness.j002.attach_dataset_directly(dataset_id);
await harness.j002.assert_scope({project_id?, resource_type?, resource_id?});
await harness.j002.assert_agent_received_scope(turn_index);
await harness.j002.freeze();                             // simulates J-001 expired_token via the existing __harness_expire_token__
await harness.j002.thaw();                               // observes orchestrator-broadcast THAW
```

Plus auxiliary read-helpers:

```ts
await harness.j002.get_session_list();
await harness.j002.get_transcript(session_id);
await harness.j002.assert_session_active(session_id);
await harness.j002.assert_session_list_includes(session_id);
await harness.j002.assert_initial_project(project_name);
await harness.j002.assert_scope_mismatch({underlying_cause_tag});
await harness.j002.assert_stale_intent_dropped(intent_type, target_id);
await harness.j002.assert_no_stale_intents_dropped();
await harness.j002.create_first_project(name);
```

All read from the same `/ui-state/flow/project-and-chat-session-management/projection` endpoint the FE reads. No parallel state.

---

## Python `DatasetLayerHarness` extension

One method per US-208 acceptance:

```python
# tests/integration/dataset_layer/harness.py — EXTENDED
async def chat_turn_with_scope_header(
    self,
    scope: ActiveScope,
    message: str,
    *,
    thread_id: str | None = None,
) -> dict:
    """Validates the agent's X-Active-Scope reading path per US-208.

    Used by tests/acceptance/project-and-chat-session-management/test_us208_agent_scope_contract.py.
    """
    headers = {
        "Authorization": f"Bearer {self.jwt}",
        "X-Active-Scope": json.dumps(scope),
    }
    payload = {"messages": [{"role": "user", "content": message}], "thread_id": thread_id}
    response = await self.client.post("/chat", json=payload, headers=headers)
    return {"status_code": response.status_code, "body": response.json(), "events": self._captured_events()}
```

This is **one method** — no fork of the harness. The existing scope-of-`DatasetLayerHarness` (backend+agent integration) is preserved; the new method is the JOB-001 acceptance for the agent contract, exercised by J-002.

---

## Open items DISTILL may surface (if any)

| # | Item | Severity | Why | Resolution path |
|---|---|---|---|---|
| O1 | The orchestrator's `j001_ready` broadcast hook does not exist in the live code (only the `priorState` watcher does) | LOW | DESIGN ratifies it lands in MR-1; DELIVER's first MR adds the hook | DELIVER MR-1 task; not a DISTILL blocker |
| O2 | Cross-tab projection-stream endpoint `/projection/stream` does not exist today | MEDIUM | Required by US-203 Example 4 + DWD-9 | MR-2 prerequisite; if DELIVER discovers `XREAD BLOCK` is more complex than estimated, scope slips by 1 day |
| O3 | The `eslint-plugin-dashboard-chat-ui-state` custom rule for `X-Active-Scope` writer enforcement does not exist | LOW | Lives in scaffolding work for MR-4; preserves DWD-3 invariant | MR-4 task |
| O4 | The `tests/acceptance/project-and-chat-session-management/pyproject.toml` does not exist today | LOW | Per-feature uv venv scaffolding for the acceptance suite; mirrors J-001 | DISTILL writes this as part of its DELIVER artifact setup |
| O5 | The orchestrator's `replay_abandoned` event for J-002 specifically must be observable | LOW | US-210 Example 3 + AC asserts on this | The orchestrator already emits `replay_abandoned` (from J-001 DELIVER); J-002's machine transitions to `error_recoverable` via the existing handler; DISTILL just asserts the existing event surface |
| O6 | The exact sunset date for `SCOPE_HEADER_FALLBACK_ENABLED` is not literal yet (DWD-3 says "set at MR-time") | LOW | Per DWD-3; the engineer landing MR-4 sets the literal date | MR-4 task; not a DISTILL concern |
| O7 | Loader fan-out coordination with frontend-coexistence Phase 04 (slate crew, auth-proxy scaling) (per Praxis F-3) | MEDIUM | J-002 adds 6–7 new RRv7 framework-mode loaders across Slices 1–2; each loader = one auth-proxy hit + one ui-state hit per page load. Phase 04's auth-proxy capacity budget accounts for J-001's 4 loaders today. Cumulative J-001 + J-002 loader fan-out has not been quantified. | Before MR-1 DELIVER, confirm with the slate crew (or its successor task tracker) that auth-proxy capacity is final. **Fallback** if Phase 04 is delayed: defer `root.tsx` loader to Slice 2 (split Slice 1 into 1a "machine + Redis-stream substrate" and 1b "root.tsx loader") — reduces Slice 1 to 4 loaders. The split is one ESM-export reshuffling; no AC changes. |

**None of these are blockers for DISTILL starting.** All are DELIVER-side tasks or DISTILL-side scaffolding.

---

## DEVOPS handoff annotations (for `nw-platform-architect`)

The DISCUSS `outcome-kpis.md` already produced the instrumentation list. DESIGN does not modify it. Specifically:

- **17 new events** to instrument (8 FE + 2 agent + 5 ui-state + 2 cross-cutting per K-J002-1..K-J002-6).
- **3 real-time dashboards** (K-J002-4 north star, K-J002-5 guardrail, K-J002-6 substrate amortization).
- **5 paging alerts** (cross-project chat-turn rate > 0; missing-scope rejection rate > 1% post-migration; atomic-switching < 99%; `scope_header_fallback_used` after sunset; `stale_intent_dropped_after_thaw` > 1/user/day).
- **Baseline-establishment effort**: ~1 day to land instrumentation BEFORE Slice 4 ships, so before/after measurement for the cross-tenant surface closure is possible.

The compose acceptance test stack (per ADR-016 + ADR-030 + ADR-034) is **unchanged by J-002** — still 7 services. The Redis usage extends (one new key prefix; one new XREAD BLOCK consumer); the dispatch is unchanged.

---

## Risks carried to DISTILL

| # | Risk | Mitigation |
|---|---|---|
| RD1 | The orchestrator's `j001_ready` broadcast hook is novel — adds a new lifecycle behavior to the orchestrator | MR-1 includes a unit test (orchestrator.test.ts) that asserts J-002 actor is spawned exactly once when J-001 transitions ready; doesn't spawn twice on re-entries; spawns once per principal_id |
| RD2 | The SSE projection-stream is novel — Redis Streams `XREAD BLOCK` is a different read pattern from XRANGE | MR-2 includes a unit test (persistence/redis.test.ts) for the subscribe() method; the probe is extended to cover subscribe lifecycle (connect, BLOCK, deliver, disconnect on tier shutdown) |
| RD3 | The agent's `extractActiveScope` middleware is purely additive but the body-fallback shape requires reading-the-body-once-and-passing-down — risk of regression in the existing `await request.json()` call | DELIVER pattern: read body once at top of handleChat; the scope-extraction function takes body as optional parameter (per app-arch §4.1 footnote); existing tests continue to pass |
| RD4 | The compile-time sunset check (DWD-3) is novel — uses `Date.now()` against a const-assigned Date | The check fails the agent's `npm start` if the date is past AND the flag is still in the codebase; CI gold-test asserts the check fires correctly under both date branches (today's date + a mocked future date) |
| RD5 | Cross-tab refresh via SSE depends on the FE's `EventSource` lifecycle being correctly managed across navigations | The chat-shell route's `useEffect` cleanup closes the EventSource; RRv7's lifecycle (unmount before mount) ensures the previous SSE is closed before a new one opens; DISTILL's cross-tab scenario asserts no duplicate connections |

---

## Sign-off checklist

### Pre-DISTILL gate (DESIGN owner = nw-solution-architect, this wave):

- [x] Reuse Analysis table populated (`wave-decisions.md` §"Reuse Analysis").
- [x] C4 L1 (System Context — inherited unchanged), L2 (Container — `c4-diagrams.md` §1), L3 (Component — §2) diagrams in Mermaid.
- [x] State chart diagram (`c4-diagrams.md` §3).
- [x] 6 sequence diagrams — one per slice (`c4-diagrams.md` §4).
- [x] Recommendation: no new ADR (DWD-12); J-002 fits in 027/028/029/030/034 envelope.
- [x] `active_scope` contract specified end-to-end (DWD-3 + app-arch §4 + §7.4).
- [x] Cross-machine FREEZE specified (DWD-6 + app-arch §3 + §10).
- [x] Stale-intent filter rule specified (DWD-7).
- [x] Session-metadata storage shape decided (DWD-2 — Option A column).
- [x] Architectural enforcement specified (lint rule per DWD-3 + DWD-4; `dependency-cruiser` per ADR-027 §7 inheritance).
- [x] External-integration contract-test annotations (none new — J-002 has no new external integrations beyond J-001's WorkOS / backend / auth-proxy; same Pact-JS posture if needed).
- [x] OSS-first validated (no new deps; everything already vendored).

### Pending (DISTILL or user):

- [ ] **nw-solution-architect-reviewer pass** on this DESIGN bundle (HARD GATE per command-args). **Re-run required after SRP amendment** (2026-05-13 — DWD-13 + companion edits).
- [ ] DISTILL writes the per-feature `pyproject.toml` + scaffolds the 10 test files.
- [ ] DISTILL formalizes all 62 scenarios.
- [ ] DISTILL produces its own `wave-decisions.md` capturing any test-framework-level decisions.
- [ ] **MR-1.5 (DELIVER refactor — NEW per DWD-13)**: split `project-and-chat-session-management.ts` into `project-context.ts` + `session-chat.ts`. Pure refactor; no behavior change; all MR-1 acceptance tests continue to pass. Adds the orchestrator's `project_ready` broadcast hook + `session-chat` MachineRegistry entry.

### Pending (DELIVER, not gating DISTILL):

- [ ] MR-1 includes the orchestrator's `j001_ready` broadcast hook (RD1).
- [ ] MR-2 includes the SSE projection-stream endpoint + subscribe() adapter method (RD2 + DWD-9).
- [ ] MR-4 sets the literal `SCOPE_HEADER_FALLBACK_SUNSET` date and lands the compile-time check (DWD-3 + RD4).
- [ ] DEVOPS lands instrumentation BEFORE Slice 4 ships (per `outcome-kpis.md` §"Baseline measurement before release").

---

## References

- DISCUSS handoff: `docs/feature/project-and-chat-session-management/discuss/handoff-design.md`
- DISCUSS wave-decisions D1–D12: `docs/feature/project-and-chat-session-management/discuss/wave-decisions.md`
- Shared artifacts registry: `docs/feature/project-and-chat-session-management/discuss/shared-artifacts-registry.md`
- User stories: `docs/feature/project-and-chat-session-management/discuss/stories/US-{201..210}.md`
- Journey contract (IMMUTABLE): `docs/feature/project-and-chat-session-management/discuss/journey-project-and-chat-session-management.yaml`
- Journey YAML embedded Gherkin: `docs/feature/project-and-chat-session-management/discuss/journey-project-and-chat-session-management.feature`
- Outcome KPIs (for DEVOPS): `docs/feature/project-and-chat-session-management/discuss/outcome-kpis.md`
- Per-slice briefs: `docs/feature/project-and-chat-session-management/discuss/slices/slice-{01..06}-*.md`
- DESIGN companion artifacts (this wave + SRP amendment): `application-architecture.md` (post-DWD-13), `wave-decisions.md` (DWD-1..DWD-13), `c4-diagrams.md` (post-DWD-13)
- **SRP review (binding input for the amendment)**: `./review-by-software-crafter-srp.md`
- **DESIGN amendment review**: `./review-by-solution-architect-srp-amendment.md`
- J-001 DESIGN → DISTILL handoff (template): `docs/evolution/2026-05-12-user-flow-state-machines/design/handoff-design-to-distill.md`
- Inherited ADRs: ADR-014, ADR-015, ADR-016, ADR-018, ADR-027, ADR-028, ADR-029, ADR-030, ADR-031 §7, ADR-034
