# Application Architecture — `project-and-chat-session-management` (J-002)

> **Wave**: DESIGN (propose mode)
> **Date**: 2026-05-13
> **Architect**: nw-solution-architect (DESIGN wave for J-002)
> **Inherited from DISCUSS**: 18 artifacts under `docs/feature/project-and-chat-session-management/discuss/` (10 stories + 6 slices + journey YAML + 6 KPIs + JTBD + shared-artifacts + wave-decisions D1–D12 + product-owner APPROVED verdict)
> **Inherited from J-001 DESIGN**: `docs/evolution/2026-05-12-user-flow-state-machines/design/{application-architecture, wave-decisions, system-architecture, c4-diagrams}.md` — substrate is amortized; J-002 plugs into it.
> **Inherited ADRs (binding)**: ADR-014 (ChatEvent stratification), ADR-015 (presentation-state log), ADR-016 (auth-proxy ingress), ADR-018 (capability-presence dispatch), **ADR-027** (ui-state tier + Remix→RRv7 framework), **ADR-028** (XState v5 actor model — IMMUTABLE), **ADR-029** (`active_scope` propagation), **ADR-030** (topology + scaling), **ADR-031 §7** (auth path), **ADR-034** (frontend coexistence via RRv7 framework mode).
> **Companion deliverables (this wave)**: `wave-decisions.md` (DWD-1..DWD-12), `c4-diagrams.md`, `handoff-design-to-distill.md`.

---

## 0. TL;DR

J-002 is a **brownfield extension** of the actor-model substrate ratified by ADRs 027–030 (and refined by ADR-034). The substrate cost is amortized. J-002 adds, in order of architectural significance:

1. **A second machine** (`projectAndChatSessionMachine`) at `ui-state/lib/machines/project-and-chat-session-management.ts` — 12 states, 1 cross-machine side-state (`freeze`), 2 exit transitions (`exit_to_J003`, `exit_to_projects_page`). Composed with J-001 via the orchestrator; no machine-to-machine import.
2. **Orchestrator machine registry** — a 1-line-per-machine strategy table replacing today's hardcoded `if (input.machine !== "login-and-org-setup")` conditional in `ui-state/lib/orchestrator.ts`. This unblocks J-003+ without further orchestrator surgery.
3. **A session schema delta** — single `active_dataset_id` column on the `sessions` table (resolves **OQ-J002-1**, Option A). One Alembic migration; `update_session.py` allowlist extension.
4. **The first end-to-end exercise of ADR-029 §4's agent-scope contract** — the `X-Active-Scope` request header becomes the EXCLUSIVE source of `(org_id, project_id, resource_*)` for `agent/lib/chat/handleChat.ts`. The body's `project_id` field becomes a one-release fallback with a compile-time sunset (resolves **D11** and **US-208 R8**).
5. **RRv7 framework-mode route migrations** — 7 J-002-territory routes graduate to loader-bearing modules across 5 files (`root.tsx`, `routes/projects.tsx`, `routes/project-detail.tsx` [two route IDs share this file], `routes/chat.tsx` [two route IDs share this file], `routes/sessions.tsx`). Each loader reads J-002's projection via the existing `frontend/app/lib/ui-state-client.ts` helper, which is extended to set `X-Active-Scope` on outgoing fetches. Per DWD-4 the migration is staged across Slices 1 + 2.
6. **Cross-machine FREEZE/THAW participation** — J-002 declares a top-level `FREEZE` handler reachable from every non-terminal state with a history-target THAW. The replay buffer (already in `ui-state/lib/orchestrator.ts:54-56,161-192`) requires NO modification — J-002 is the first **consumer** of the substrate ADR-028 §94 promised, not a producer of new orchestrator primitives.

**No new ADR is needed.** J-002 fits cleanly inside the existing 027/028/029/030/034 envelope. The two DESIGN-level decisions DISCUSS deferred (OQ-J002-1 storage shape; OQ-J002-6 stale-intent filter) are resolved in `wave-decisions.md` DWD-2 and DWD-7.

**The North Star (K-J002-4 — atomic project switching with zero cross-tenant chat-turns)** is mechanically retired by the composition of (a) the new machine's `switching_project` state with atomic `session_id`/`resource_*` invalidation, (b) the FE SSE cancellation contract on unmount, and (c) the agent's header-only scope read with JWT-vs-header `org_id` parity check.

---

## 1. Composition with the existing substrate (what J-002 inherits unchanged)

J-002 is the **second** machine plugged into the actor tree at `ui-state/index.ts`. Every primitive J-002 needs already exists. The mandatory orientation matrix:

| Substrate concern | Status today | J-002 impact |
|---|---|---|
| XState v5 actor model (ADR-028) | Live; one machine (`login-and-org-setup`) registered | J-002 declares its own machine via the same `setup({...}).createMachine(...)` shape; orchestrator spawns a sibling actor; the two communicate ONLY via orchestrator broadcast (`FREEZE`/`THAW`) per ADR-028:46-48. |
| Flow event log + Redis dispatch (ADR-018 inheritance) | Live; key prefix `ui-state:{flow_id}:events`; `selectFlowEventStore` dispatch | J-002 reuses the same `FlowEventLog` port; new key prefix value `ui-state:project-and-chat-session-management:<principal_id>:events`. **No new env var, no new dispatch.** |
| Projection contract (ADR-027 §4) | Live; pure function `FlowEvent[] → FlowProjection` at `ui-state/lib/projection.ts` | J-002 extends the `EVENT_HANDLERS` dispatch table at `projection.ts:107-242` with J-002 event types (`project_selected`, `session_resumed`, `dataset_resolved_by_agent`, …). The projection-level `active_scope` field continues to be derived from `context.resolved_scope`/`context.org` — J-002 populates `resolved_scope.project_id` and `resource_*` per ADR-029 §1. The `FlowProjection` envelope shape (`{flow_id, state, context, active_scope, sequence_id, last_event_at, correlation_id}`) is **unchanged**; J-002's flow-specific shape lives inside `context.*` (Slice 1 introduces `context.project`, `context.session_list`, `context.session_id`, `context.transcript`, `context.session_active_dataset_id` — see §7). |
| ScopeResolver (ADR-029 §1 invariants 1–5) | Live; pure fn at `ui-state/lib/active-scope.ts:80-142` | J-002 calls the resolver verbatim. The two J-002-specific deep-link cases (cross-tenant 403, stale-link reconciliation) hit invariants 4 and 5 unchanged. **The resolver itself is NOT modified by J-002.** What J-002 adds is *call sites* — the new machine emits `deep_link_opened` events that flow into the existing `EVENT_HANDLERS["deep_link_opened"]` reducer, and the new `switching_project` state emits a `scope_reconciled` event when mid-session URL change reconciles. |
| Orchestrator (`ui-state/lib/orchestrator.ts`) | Live; supervises actor tree; broadcasts FREEZE/THAW; owns 5-second/16-event replay buffer | The orchestrator gains a **machine registry table** so it can `begin_flow({machine: "project-and-chat-session-management"})` without a hardcoded branch. The FREEZE/THAW broadcast logic and the replay buffer are **byte-unchanged** — they enumerate all spawned actors regardless of machine type. |
| Auth-proxy ingress (ADR-016 + ADR-031 §7) | Live; sole production ingress | J-002's projection endpoint URL family is `/ui-state/flow/project-and-chat-session-management/{begin,event,projection,open-deep-link}`. Auth-proxy's existing `/ui-state/*` forward rule needs no change. RRv7 loaders read `request.headers.get('Authorization')` and forward Bearer per ADR-031 §7 (`web-ssr` substituted for `ui-presentation` per ADR-034). |
| RRv7 framework mode (ADR-034) | MR-0 plumbing landed (Phase 03 just merged at HEAD 89bab77); five existing routes are library-mode; `app/lib/ui-state-client.ts` exists but dormant | J-002 graduates 5 routes from library-mode to framework-mode (loader exports). The `uiStateClient` helper grows ONE method (`postEvent`) and starts setting `X-Active-Scope` on outgoing fetches. **`frontend/app/root.tsx` adds a root loader** that reads J-001's projection for `active_scope.{org_id}` (Slice 1 prerequisite — see §6.1). |
| Agent chat brain (D8 carried) | Live; `agent/lib/chat/handleChat.ts:75` reads `project_id` from request body unconditionally | J-002 adds **scope-extraction middleware** (one function, ~30 LOC) at the start of `handleChat`. The middleware reads `X-Active-Scope`, validates `org_id` vs `X-Org-Id`, validates `project_id` non-null, and (during the migration window) falls back to body `project_id` while emitting `scope_header_fallback_used`. **The chat-turn streaming, the Groq SSE, the tool dispatch, the ADR-015 directive log, and the `pipeChatStream` typed-part interception are all unchanged.** |

The **net new infrastructure cost is two source files, one Alembic migration, one orchestrator-registry refactor, one agent middleware, one root-loader, five route-loader migrations, one uiStateClient method extension, and one TypeScript shared scope-type re-export**. Everything else is precedent.

---

## 2. The J-002 machine — XState v5 statechart sketch

> **Source contract**: `docs/feature/project-and-chat-session-management/discuss/journey-project-and-chat-session-management.yaml` (12 states + side-states; IMMUTABLE per DISCUSS D6).

This section maps the 12 journey states to concrete XState v5 transitions. Each state is a flat (non-parallel) sibling under the root `id: "project-and-chat-session-management"`. DWD-1 in `wave-decisions.md` ratifies flat-compound over parallel-region — there is no concurrent sub-region in J-002's behavior (the `switching_dataset_context` state runs to completion before `session_active` re-enters; XState's single-event-at-a-time semantics handle the concurrency case per US-209 Example 5).

### 2.1 Machine context (TypeScript types)

```ts
// ui-state/lib/machines/project-and-chat-session-management.ts (NEW FILE — DELIVER artifact)

import { assign, fromPromise, setup } from "xstate";
import type { ActiveScope, ResourceType } from "../active-scope.ts";

export type J002State =
  | "resolving_initial_scope"
  | "no_projects_empty_state"
  | "creating_project"
  | "project_selected"
  | "loading_session_list"
  | "session_list_visible"     // also subsumes the no_sessions_empty_state UI sub-shape (cf. §2.3)
  | "resuming_session"
  | "session_active_no_messages"
  | "session_active"
  | "switching_dataset_context"
  | "switching_project"
  | "scope_mismatch_terminal"
  | "error_recoverable"
  | "freeze";

export interface ProjectSummary {
  id: string;
  name: string;
}

export interface SessionSummary {
  id: string;
  title: string | null;
  last_active_at: string;     // ISO timestamp
  active_dataset_id: string | null;
}

export interface J002MachineContext {
  correlation_id: string;
  principal_id: string;

  // J-001 projection (read-only consumption — set on entry from J-001 ready):
  org_id: string;
  user_first_name: string | null;

  // The authoritative project context — populated on project_selected entry:
  project: { id: string | null; name: string | null };

  // Session list state for the current project — populated on session_list_visible entry:
  session_list: SessionSummary[];
  session_list_next_cursor: string | null;
  most_recent_session_per_project: Record<string /* project_id */, string /* iso ts */>;  // for last-used resolution per OQ-J002-5

  // The active session — populated on session_active entry (lazily; null in session_active_no_messages):
  session_id: string | null;
  transcript: TranscriptMessage[];

  // The active resource (dataset) — populated on session_active entry + switching_dataset_context exit:
  resource: { type: ResourceType | null; id: string | null };

  // Intent payloads — populated on transitions; cleared on settle:
  intent_project_id: string | null;
  intent_session_id: string | null;
  intent_resource_id: string | null;
  intent_resource_type: ResourceType | null;

  // Cross-state plumbing:
  underlying_cause_tag: J002CauseTag | null;
  last_live_state: J002State | null;   // for freeze → history target on THAW per US-210
  retries: number;
  pending_project_name: string;        // composer state preserved across creating_project retries

  // Observability counters:
  scope_reconciled_count: number;
  stale_intents_dropped_count: number;
}

export type J002CauseTag =
  | "no_projects"
  | "transient"
  | "project_not_found"
  | "cross_tenant"
  | "access_revoked"
  | "dataset_not_found"
  | "dataset_access_denied"
  | "session_not_found"
  | "list_sessions_degraded"
  | "replay_abandoned";

export type J002Event =
  // External user-action / FE-emitted events:
  | { type: "open_deep_link"; intent_project_id?: string; intent_session_id?: string; intent_resource_id?: string; intent_resource_type?: ResourceType }
  | { type: "j001_ready"; org_id: string; user_first_name: string }   // entry from J-001 — orchestrator-broadcast on J-001 ready
  | { type: "create_project_clicked" }
  | { type: "create_project_submitted"; org_name: string }            // composer text on submit
  | { type: "session_clicked"; session_id: string }
  | { type: "new_session_clicked" }
  | { type: "first_message_sent"; content: string }
  | { type: "switching_project_intent"; new_project_id: string }
  | { type: "dataset_resolved_by_agent"; resource_id: string; resource_type: ResourceType }
  | { type: "dataset_picked_directly"; resource_id: string; resource_type: ResourceType }
  | { type: "retry_clicked" }
  | { type: "back_to_projects_clicked" }
  | { type: "suggestion_chip_clicked_upload" }
  | { type: "suggestion_chip_clicked_browse_projects" }
  // Cross-machine signals (orchestrator-emitted; never FE-emitted):
  | { type: "FREEZE"; origin_correlation_id: string }
  | { type: "THAW" };

interface TranscriptMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  ts: string;
}
```

The `J002CauseTag` union is closed (per ADR-029 §"named diagnostic" discipline) so the FE renders deterministic copy variants from `state.context.underlying_cause_tag`.

### 2.2 Top-level FREEZE handler (per US-210 / Slice 6)

XState v5's top-level `on` is inherited by every state. The machine declares:

```ts
.createMachine({
  id: "project-and-chat-session-management",
  initial: "resolving_initial_scope",
  on: {
    // Reachable from EVERY non-terminal state (US-210 AC) — XState top-level `on` semantics.
    FREEZE: {
      target: ".freeze",
      actions: assign({
        last_live_state: ({ context, _state }) => _state /* XState v5 exposes the current state value here */,
      }),
    },
  },
  states: {
    // … 14 states below …
  },
})
```

The `freeze` state itself declares `on: { THAW: { target: <history target via last_live_state lookup> } }` per US-210 AC. Implementation pattern (XState v5 supports `history: "shallow"` on a state, but we use an explicit `last_live_state` field for testability — the harness asserts on it; see DWD-6 for rationale).

### 2.3 State-by-state mapping

Each row below maps one of the journey YAML's 12 states to its concrete XState transition set. **`on` events derive from the journey YAML's `transitions` block (IMMUTABLE) plus the top-level `FREEZE` handler above. `invoke` actors are declared at the `setup({actors: {...}})` level (factory wiring in §3).**

| Journey state | XState `on` events → target | `invoke` actor | `actions` (entry / exit / transition) | Story coverage |
|---|---|---|---|---|
| `resolving_initial_scope` (initial) | `j001_ready` → self (entry from J-001); `resolved_with_project` → `project_selected`; `resolved_no_projects` → `no_projects_empty_state`; `scope_mismatch` → `scope_mismatch_terminal`; `open_deep_link` → self (re-resolve) | `resolveInitialScope` (input: `{org_id, intent_project_id?, intent_session_id?, intent_resource_id?, principal_id}`; output: `{project: ProjectSummary, session_list?: SessionSummary[]} \| {no_projects: true} \| {cross_tenant: true}`). Reads `list_projects(user)` + `most_recent_session_per_project` lazily per OQ-J002-5 / DWD-9. | Emit `j002_resolution_started`; on settle emit `project_selected` / `no_projects_displayed` / `scope_mismatch_displayed` and assign `context.project`/`context.org_id`/`context.most_recent_session_per_project`. | US-201, US-202, US-204 |
| `no_projects_empty_state` | `create_project_clicked` → `creating_project`; `create_project_submitted` → `creating_project` (with composer payload) | (none — interactive) | Entry assigns `context.underlying_cause_tag = "no_projects"`; emit `no_projects_displayed`. | US-201 |
| `creating_project` | invoke `onDone` → `project_selected`; invoke `onError` (`validation_failed`) → `no_projects_empty_state`; invoke `onError` (transient) → `error_recoverable` | `createProject` (input: `{org_name, correlation_id, principal_id}`; output: `ProjectSummary`). Wraps `POST /api/projects` via `uiStateClient`. | Emit `project_creation_started`; on success emit `project_created` and assign `context.project`; on validation fail set `context.org_validation_error` (mirrors J-001 `recordOrgValidationError` action at `login-and-org-setup.ts:163-183`). | US-201 |
| `project_selected` | entry-spawn → `loading_session_list`; `switching_project_intent` → `switching_project` | (none — fires side-effect on entry) | Entry assigns `context.project`, emits `project_selected`; entry-action spawns `loading_session_list` via `raise({ type: "session_list_load_started" })` (XState v5 idiom). | US-202, US-204, US-207 |
| `loading_session_list` | invoke `onDone` → `session_list_visible`; invoke `onError` (transient) → `error_recoverable` (cause `list_sessions_degraded`) | `loadSessionList` (input: `{project_id, principal_id}`; output: `{items: SessionSummary[], next_cursor: string \| null, has_more: boolean}`). Wraps `list_sessions(project_id, user, page_size=30)`. | Entry emits `session_list_load_started`; on success assigns `context.session_list` + `context.session_list_next_cursor`, emits `session_list_loaded`. | US-203 |
| `session_list_visible` | `session_clicked` → `resuming_session`; `new_session_clicked` → `session_active_no_messages`; `switching_project_intent` → `switching_project`; `suggestion_chip_clicked_upload` → `exit_to_J003`; `suggestion_chip_clicked_browse_projects` → `exit_to_projects_page` | (none — interactive) | Entry emits `session_list_displayed { project_id, session_count }`. The `no_sessions_empty_state` is **not a separate XState state** — it is a derived UI shape when `context.session_list.length === 0`. (DWD-1: a sub-state name in the journey YAML that has no distinct transitions collapses to its parent state plus a derived UI predicate; the journey YAML's `no_sessions_empty_state` exists only for emotional-arc clarity per DISCUSS D8 and IS rendered by the FE as a sub-shape of `session_list_visible`.) | US-203 |
| `resuming_session` | invoke `onDone` → `session_active`; invoke `onDone` (`session_not_found`) → `session_list_visible`; invoke `onError` (transient) → `error_recoverable` | `resumeSession` (input: `{session_id, principal_id}`; output: `{session_id, transcript: TranscriptMessage[], active_dataset_id: string \| null} \| {session_not_found: true}`). Loads transcript via `list_session_events` AND reads `session.active_dataset_id` from `get_session(session_id)` per DWD-2. | Entry emits `session_resume_started { session_id, correlation_id }`; on success assigns `context.session_id`, `context.transcript`, AND (if `active_dataset_id` resolves) `context.resource.{type: "dataset", id: active_dataset_id}`; emits `session_resumed`. If `active_dataset_id` is set but get_dataset 404s, assigns `context.resource = {type: null, id: null}` and emits `session_dataset_unavailable`. | US-205 |
| `session_active_no_messages` | `first_message_sent` → `session_active` (via `create_session` invoke); `session_clicked` → `resuming_session`; `new_session_clicked` → self (no-op); `switching_project_intent` → `switching_project` | `createSessionEagerly` (input: `{project_id, principal_id, first_message: string}`; output: `SessionSummary`). Fires `POST /api/projects/:id/sessions` AND fire-and-forget `update_session(id, {title: first_message[:80]})`. | Entry emits `session_welcome_displayed`. On `first_message_sent` invoke fires; on success assigns `context.session_id`, emits `session_active_reached` and the first chat-turn dispatches FROM the FE (NOT from this state — the FE awaits the projection's `session_id` then POSTs `/chat` per US-208 contract). The composer text is preserved by the FE's `useLoaderData` not re-running on the in-place transition; if `error_recoverable` fires, the FE's composer-state carries the text through (see §6.4). | US-206 |
| `session_active` | `session_clicked` → `resuming_session`; `new_session_clicked` → `session_active_no_messages`; `switching_project_intent` → `switching_project`; `dataset_resolved_by_agent` → `switching_dataset_context`; `dataset_picked_directly` → `switching_dataset_context` | (none — interactive; chat turns dispatch from FE) | Entry emits `session_active_reached { project_id, session_id, resource_type, resource_id, correlation_id }`. This is J-002's "ready" — the analog of J-001 `ready`. | US-205, US-206, US-209 |
| `switching_dataset_context` | invoke `onDone` (`dataset_attached`) → `session_active`; invoke `onDone` (`dataset_access_denied`) → `session_active`; invoke `onError` (transient) → `error_recoverable` | `switchDatasetContext` (input: `{session_id, intended_resource_type, intended_resource_id, principal_id, prior_resource: {type, id}}`; output: `{resource_type, resource_id, persisted: true} \| {dataset_access_denied: true, prior_resource: {type, id}}`). Calls ScopeResolver invariant 4 first; on pass calls `update_session(session_id, {active_dataset_id: <id>})` per DWD-2 + DWD-5. | Entry emits `switching_dataset_context_started`. On success assigns `context.resource` to new values, emits `dataset_attached`. On 403 leaves `context.resource` UNCHANGED, assigns `context.underlying_cause_tag = "dataset_access_denied"`, emits `dataset_access_denied`. | US-209 |
| `switching_project` | invoke `onDone` → `project_selected`; invoke `onDone` (`cross_tenant`/`access_revoked`) → `scope_mismatch_terminal`; invoke `onError` (transient) → `error_recoverable` | `switchProject` (input: `{new_project_id, principal_id, prior: {session_id, resource}}`; output: `{project: ProjectSummary} \| {cross_tenant: true} \| {access_revoked: true}`). Calls ScopeResolver invariant 4 first; on pass calls `get_project(new_project_id)`. | Entry assigns `context.session_id = null`, `context.resource = {type: null, id: null}`, `context.intent_project_id = event.new_project_id`, emits `switching_project_started { old_project_id, new_project_id, correlation_id }`. The FE's SSE cancellation is triggered by the projection's `state` transitioning to `switching_project` — the chat-view component's `useEffect` cleanup calls `eventSource.close()` (US-207 AC). | US-207 |
| `scope_mismatch_terminal` | `back_to_projects_clicked` → `resolving_initial_scope` (with intent cleared) | (none — terminal-recoverable) | Entry emits `scope_mismatch_displayed { intent_project_id, underlying_cause_tag, correlation_id }`. The "terminal" qualifier is a UX label — the user always has the "Back to projects" exit. | US-204 |
| `error_recoverable` | `retry_clicked` → originating-state via `last_live_state` history-target | (none — recoverable) | Entry emits `j002_recoverable_error { underlying_cause_tag, correlation_id, originating_state }`; preserves originating user-action payload in `context.pending_*` for re-issue (e.g., `pending_project_name` for US-201 retry; `pending_first_message` for US-206 retry). | All slices |
| `freeze` (side-state, reachable via top-level `on.FREEZE`) | `THAW` → `last_live_state` (history target lookup); `replay_buffer_abandoned` (from orchestrator after 5s) → `error_recoverable` (with cause `replay_abandoned`) | (none — side-state) | Entry emits `j002_frozen { last_live_state, correlation_id }`. **No outgoing mutations** while in freeze — invokes are NOT spawned in this state. The FE renders the "Refreshing your session..." banner overlay on top of the prior state's last paint (US-210 Example 5). | US-210 |

**Exit transitions** (`exit_to_J003`, `exit_to_projects_page`) are not internal XState states — they are *navigation side-effects* emitted as events whose handlers fire `history.push` in the FE. The journey YAML calls them out for inventory completeness; the J-002 machine never has them as `state.value`.

### 2.4 Total state count

Concrete XState `states:` block size: **14 entries** (12 journey states + `error_recoverable` reachable from invoke errors + `freeze` side-state). The journey YAML's `no_sessions_empty_state` collapses into `session_list_visible` per DWD-1; the two `exit_to_*` entries are navigation events, not states. This matches the journey YAML's IMMUTABLE 12-state contract (the YAML lists `error_recoverable` and `freeze` as kinds `recoverable-error` and `cross-machine-suspension` — the 12 narratively-named states + 2 cross-cutting states = the YAML's full enumeration).

---

## 3. Cross-machine composition with J-001

> **Source contract**: ADR-028 §"Decision outcome" + `ui-state/lib/orchestrator.ts:327-411` (FREEZE/THAW broadcast).

### 3.1 The orchestrator extension (DWD-8)

Today the orchestrator hardcodes `if (input.machine !== "login-and-org-setup") throw new Error(...)` (per the survey of `ui-state/lib/orchestrator.ts:104-107`). DESIGN replaces this with a **machine registry** — a one-line-per-machine strategy table at the orchestrator's composition root.

```ts
// ui-state/lib/orchestrator.ts — DELIVER artifact (DWD-8)

import { createLoginAndOrgSetupMachine, type LoginMachineDeps } from "./machines/login-and-org-setup.ts";
import { createProjectAndChatSessionMachine, type J002MachineDeps } from "./machines/project-and-chat-session-management.ts";

type MachineFactory = (input: { correlation_id: string; principal_id: string }) => AnyStateMachine;

interface MachineRegistry {
  "login-and-org-setup": MachineFactory;
  "project-and-chat-session-management": MachineFactory;
  // (Future: "dataset-upload", "transform", etc. — one line each.)
}

export class FlowOrchestrator {
  private readonly registry: MachineRegistry;

  constructor(private readonly deps: OrchestratorDeps) {
    this.registry = {
      "login-and-org-setup": (input) =>
        createLoginAndOrgSetupMachine(deps.loginMachineDeps).provide({ /* … */ }),
      "project-and-chat-session-management": (input) =>
        createProjectAndChatSessionMachine(deps.j002MachineDeps).provide({ /* … */ }),
    };
  }

  // begin() looks up the factory; otherwise byte-identical to today
  async begin(input: BeginFlowInput): Promise<FlowProjection> {
    const factory = this.registry[input.machine];
    if (!factory) throw new Error(`unknown machine: ${input.machine}`);
    // … rest unchanged …
  }
}
```

**Effect**: J-003+ machines plug in via one new factory + one registry line. No `if/else` cascade.

**Reversibility**: if J-002 misbehaves at MR-time, deleting its factory entry + the machine file disables it without orchestrator surgery.

### 3.2 FREEZE/THAW participation (DWD-6)

`ui-state/lib/orchestrator.ts:327-411` already implements:
- `broadcastFreeze(originFlowId)` — enumerates all spawned actors via `this.actors.entries()`, marks them in the `frozen` Map, sends `{ type: "FREEZE" }` to each child actor.
- `broadcastThaw(originFlowId)` — enumerates the `frozen` Map, replays queued events in arrival order with original correlation_id, clears state.
- Buffer bounded: `REPLAY_BUFFER_CAP = 16`, `FREEZE_WINDOW_MS = 5000`.

J-002's machine declares the top-level `on.FREEZE` handler (§2.2) and the `freeze` side-state's `on.THAW` (§2.3). **The orchestrator code is byte-unchanged.** Enumeration is machine-agnostic — when J-002's actor is spawned and registered in `this.actors`, the existing broadcast loop reaches it.

The trigger for FREEZE remains J-001's `LoginAndOrgSetupMachine` transitioning to `expired_token` (detected by the orchestrator's `priorState` map per `orchestrator.ts:91-94`). J-002 is a pure consumer — it never EMITS `FREEZE`, only handles it. This is the architectural payoff ADR-028 §94 named — and Slice 6 is the first slice that observes it in production.

### 3.3 The `j001_ready` entry event (DWD-6 corollary)

When J-001 settles in `ready`, J-002 must be spawned and given the inherited `(org_id, user.display_name)`. Two options were considered:

| Option | Mechanism | Outcome |
|---|---|---|
| **A** | J-002 spawned eagerly when J-001 reaches `ready`; orchestrator emits `j001_ready` event to J-002 with payload `{org_id, user_first_name}`. | **Chosen.** Single trigger point in orchestrator (the same `priorState` watcher that drives FREEZE/THAW); J-002's `resolving_initial_scope` invoke fires with `org_id` already populated; no race window. |
| B | J-002 spawned lazily on first FE projection read; resolver reads J-001 projection inline. | Rejected: introduces a second source of truth for `org_id`; the FE could read J-002 before J-001's `ready` event lands, surfacing an empty-scope projection briefly. |

The orchestrator's `priorState` map (`orchestrator.ts:91-94`) is extended with a per-flow callback hook: when `priorState[loginFlowId] === "creating_org"` and the new state is `ready`, the orchestrator calls `this.beginIfNotStarted({machine: "project-and-chat-session-management", principal_id: <same>})` AND sends J-002 the `j001_ready` event. The hook is a pure additive — no change to existing J-001 behavior.

### 3.4 ADR-028:46-48 enforcement (no machine-to-machine imports)

`project-and-chat-session-management.ts` MUST NOT `import` from `login-and-org-setup.ts`. The orchestrator is the only mediator. Enforcement: the existing `dependency-cruiser` rule from ADR-027 §7 already covers this (`machines/` may not import sibling `machines/*.ts`); DESIGN adds no new rule.

J-002 reads `org_id` and `user.display_name` from **its own context** (set on the `j001_ready` event); it does not call into J-001's projection from inside the machine. The composition is one-way: J-001 → orchestrator → J-002 (entry); orchestrator → J-002 (FREEZE/THAW).

---

## 4. Composition with the agent — `X-Active-Scope` contract (DWD-3)

> **Source contracts**: ADR-029 §4 (header contract; previously aspirational), US-208 (this wave's load-bearing exercise), DISCUSS D11 (backward-compat fallback), risk R8 (legacy-client tail).

### 4.1 The wire-shape change at `agent/lib/chat/handleChat.ts`

**Today** (`handleChat.ts:74-76`):

```ts
export async function handleChat(request: Request, env: Env): Promise<Response> {
  const { messages, tableSchema, contextType, contextId, thread_id, project_id } =
    (await request.json()) as ChatRequest;
  // … project_id read unconditionally from body …
```

**After J-002 DELIVER Slice 4** (handleChat.ts:74-130 refactor):

```ts
export async function handleChat(request: Request, env: Env): Promise<Response> {
  const scope = extractActiveScope(request, env);          // NEW — header-only read with fallback
  if (!scope.ok) {
    return new Response(JSON.stringify({ error: scope.error }), {
      status: scope.statusCode, headers: { "Content-Type": "application/json" },
    });
  }
  const body = (await request.json()) as ChatRequest;
  const { messages, tableSchema, contextType, contextId, thread_id } = body;
  // project_id is no longer destructured from body — comes from scope.project_id
  // …
  const dispatchCtx: DispatchContext = {
    jwt,
    datasetId: scope.resource_type === "dataset" ? scope.resource_id ?? undefined : undefined,
    projectId: scope.project_id,                            // CHANGED — from header, not body
    contextType: scope.resource_type === "dataset" ? "dataset" : scope.resource_type === "report" ? "report" : "project",
    // … rest unchanged …
  };
  // …
}

// NEW helper — lives in agent/lib/chat/scope.ts (NEW FILE)
type ExtractScopeResult =
  | { ok: true; org_id: string; project_id: string; resource_type: ResourceType | null; resource_id: string | null; from: "header" | "body_fallback" }
  | { ok: false; statusCode: 400 | 403; error: string };

function extractActiveScope(request: Request, env: Env): ExtractScopeResult {
  const xActiveScope = request.headers.get("X-Active-Scope");
  const xOrgId = request.headers.get("X-Org-Id") ?? "";    // auth-proxy-injected

  if (xActiveScope) {
    let parsed: Partial<ActiveScope>;
    try {
      parsed = JSON.parse(xActiveScope);
    } catch {
      return { ok: false, statusCode: 400, error: "agent invocation missing scope: X-Active-Scope is not valid JSON" };
    }
    if (!parsed.org_id) return { ok: false, statusCode: 400, error: "agent invocation missing scope: missing org_id" };
    if (!parsed.project_id) return { ok: false, statusCode: 400, error: "agent invocation missing scope: missing project_id" };
    if (xOrgId && parsed.org_id !== xOrgId) {
      return { ok: false, statusCode: 403, error: "scope mismatch: jwt.org_id != X-Active-Scope.org_id" };
    }
    return { ok: true, org_id: parsed.org_id, project_id: parsed.project_id,
             resource_type: parsed.resource_type ?? null, resource_id: parsed.resource_id ?? null, from: "header" };
  }

  // Backward-compat window — controlled by SCOPE_HEADER_FALLBACK_ENABLED env flag with compile-time sunset.
  // Per DWD-3 + US-208 AC + R8 mitigation.
  if (env.SCOPE_HEADER_FALLBACK_ENABLED === "true") {
    // Caller must still pass project_id in body during the migration window.
    // We can't read the body here (it's a stream); fallback is wired one level up in handleChat itself.
    // See handleChat.ts refactor — when extractActiveScope returns { from: "body_fallback_required" }, the caller reads project_id from body.
    return { ok: true, org_id: xOrgId, project_id: BODY_FALLBACK_SENTINEL,
             resource_type: null, resource_id: null, from: "body_fallback" };
  }

  return { ok: false, statusCode: 400, error: "agent invocation missing scope: missing org_id" };
}
```

The minor wrinkle (body-stream-already-consumed) is handled by reading the JSON body once at the top of `handleChat` and threading `project_id` from body into `extractActiveScope` as an optional fallback parameter; the snippet above is the conceptual shape. **The exact return-type union, error-handling semantics, and the body-fallback wiring will be finalized during DELIVER MR-4 based on the body-stream constraint; the DISTILL acceptance tests gate the externally-observable behavior (header-preferred read, 400 / 403 / fallback rules) rather than the internal function signature.**

### 4.2 The migration window (R8 mitigation — DWD-3)

The fallback path emits a `scope_header_fallback_used { calling_client }` log event identifying the User-Agent. The flag `SCOPE_HEADER_FALLBACK_ENABLED` defaults TRUE for the J-002 DELIVER release **and the immediate next release**, then defaults FALSE forever.

**Compile-time sunset** (per US-208 AC + R8): `agent/lib/chat/handleChat.ts` includes a `const SCOPE_HEADER_FALLBACK_SUNSET: Date = new Date("YYYY-MM-DD")` (the date set at MR-time to ~6 weeks post-J-002-DELIVER). A `static_assert`-style check at module load asserts `Date.now() < SCOPE_HEADER_FALLBACK_SUNSET.getTime()` — if violated, the agent **fails to start** with a structured `agent.startup.refused: scope_header_fallback_sunset_passed` log. This forces the flag-removal change to land on time. ([DWD-3 ratifies the date-string mechanism; the literal sunset date is set by the engineer landing US-208 in DELIVER.](./wave-decisions.md))

### 4.3 The FE side: `uiStateClient` extension

`frontend/app/lib/ui-state-client.ts` today exposes one method (`getProjection`). J-002 extends it:

```ts
// frontend/app/lib/ui-state-client.ts — extension (DWD-4)

export function uiStateClient(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";

  return {
    async getProjection(machine: string, flowId?: string): Promise<FlowProjection> { /* unchanged */ },

    // NEW — Slice 1+ usage (root loader; project-detail loader; etc.)
    async getJ002Projection(
      principal_id: string,
      intent?: { project_id?: string; session_id?: string; resource_id?: string; resource_type?: ResourceType },
    ): Promise<J002FlowProjection> { /* fetches GET /ui-state/flow/project-and-chat-session-management/projection?flow_id=…
                                       ; optionally posts open-deep-link first */ },

    // NEW — Slice 1+ usage (loaders fire transitions to the J-002 machine)
    async postJ002Event(
      principal_id: string,
      event: { type: string; payload: Record<string, unknown>; correlation_id: string },
    ): Promise<J002FlowProjection> { /* POSTs /ui-state/flow/project-and-chat-session-management/event */ },

    // NEW — Slice 4 usage (every outgoing FE → agent/backend call). Builds the header from a projection.
    //   Auth-proxy and backend already strip/inject this on the way out; the FE just sets it on outbound fetches.
    activeScopeHeader(projection: J002FlowProjection): string {
      return JSON.stringify(projection.active_scope);
    },
  };
}
```

The `activeScopeHeader` helper is the **single writer** of `X-Active-Scope`. No FE component ever constructs the header inline. The Slice 4 ESLint rule (per ADR-029 §2 lint contract + US-208 AC) forbids manual `X-Active-Scope` header sets outside this helper.

### 4.4 Reuse-vs-extend decision for the agent middleware

The agent currently has scaffold-level middleware (Hono `c.req.header(...)`) but no scope-extraction concern. **EXTENDED**, not replaced. The new function `extractActiveScope` is added as a sibling to `extractJwt` (`handleChat.ts:66-72`). Hono middleware is not introduced; the extraction is a function call inside `handleChat`. Rationale: scope is only relevant to chat-shaped endpoints; making it global middleware would add startup-time concerns to the non-chat routes (e.g., `/health`). Per DISCUSS D8 (agent stays the chat brain), keeping it inline preserves the narrow blast-radius.

---

## 5. Composition with the backend — `session.active_dataset_id` schema delta (DWD-2 / OQ-J002-1)

> **Source contracts**: DISCUSS D11 (storage shape DESIGN-deferred); US-205 (resume must restore dataset chip); US-209 (switching_dataset_context persists the new id).

### 5.1 The decision — Option A (column on session row)

DWD-2 in `wave-decisions.md` ratifies **Option A: new `active_dataset_id` column on the `sessions` table**, NOT side-log (Option B) or event-stream denormalization (Option C). Detailed rationale lives in `wave-decisions.md`; the architectural summary:

- **Option A is the smallest schema delta** — one nullable column on an existing table. Reads via existing `get_session(session_id)`; writes via extension of `update_session(session_id, {active_dataset_id: <id>})`. No new repository method, no new aggregate.
- **Option B (side-log table)** is future-extensible (history-aware, supports "what dataset was attached when") but **gates Slice 2 on a brand-new aggregate** for a feature DISCUSS did not commit to (history queries are NOT in J-002's scope per D6).
- **Option C (session-event-stream denormalization)** is the highest conceptual purity but **requires the Stream.io reader from `backend/app/use_cases/session/event_replay.py` to be wired beyond noop** — that's a separate cross-cutting infrastructure project blocking J-002 DELIVER on infra not under J-002's control.

The product-owner recommendation in `handoff-design.md` (Luna's posture: "Option A for PR-0") aligns; the architect agrees on identical grounds.

### 5.2 The schema delta (concrete)

**Migration file** (new): `backend/migrations/versions/009_add_session_active_dataset_id.py`:

```python
"""Add session.active_dataset_id for J-002 session-bound dataset context.

Revision ID: 009
Revises: 008
Create Date: 2026-05-13

Per J-002 DESIGN (DWD-2 / OQ-J002-1 Option A): the active dataset attachment
for a session is a nullable foreign key to the dataset table. Storing the
value as a column (vs. event-stream denormalization) is the smallest delta
that satisfies the US-205 resume-restoration AC and the US-209 switching
write-back AC.
"""

from alembic import op
import sqlalchemy as sa

revision = "009"
down_revision = "008"

def upgrade() -> None:
    op.add_column(
        "sessions",
        sa.Column("active_dataset_id", sa.String(length=36), nullable=True),
    )
    # Index for the (rare) reverse-lookup "which sessions reference this dataset" query.
    # NOT a foreign key — datasets are deletable independently; the J-002 resume path
    # tolerates a stale id by transitioning to session_active with resource_* null and
    # emitting session_dataset_unavailable (US-205 Example 3). Keeping it unconstrained
    # also avoids a CASCADE that would silently zero out user-attached context.
    op.create_index(
        "ix_sessions_active_dataset_id",
        "sessions",
        ["active_dataset_id"],
    )

def downgrade() -> None:
    op.drop_index("ix_sessions_active_dataset_id", table_name="sessions")
    op.drop_column("sessions", "active_dataset_id")
```

The column is **String(36)** (UUID-shaped, matching `Dataset.id` per repo conventions) and **nullable** because:

1. Pre-existing sessions have no attached dataset (the column is added on existing rows; default NULL).
2. The conversational mode (`session_active` with `resource_* = null`) is a first-class state per US-205 Example 2.
3. Deleted datasets degrade to NULL via application logic on resume (US-205 Example 3), not a CASCADE.

### 5.3 The use-case allowlist extension

`backend/app/use_cases/session/update_session.py:50-52` today restricts updates to `{"title", "last_active_at"}`. The patch:

```python
# After J-002 DELIVER Slice 5 (DWD-2):
allowed_fields = {"title", "last_active_at", "active_dataset_id"}
```

A one-line allowlist change. **No new use case** is introduced; J-002's `switching_dataset_context` invoke calls the existing `update_session` via the existing port (`uiStateClient → /api/sessions/:id` route).

**`get_session(session_id)` already returns the full row** (see `backend/app/repositories/metadata/session_record.py:1-38` per the code survey) — the new column flows through automatically once added.

### 5.4 Cross-tenant safety on dataset attach

The `switching_dataset_context` invoke calls ScopeResolver invariant 4 BEFORE issuing the write. The backend's existing `authorize_project_access` dependency already enforces `dataset.project_id == active_project_id`; ScopeResolver invariant 4 mirrors this at the ui-state tier as defense in depth.

Implementation flow:
1. J-002's `switchDatasetContext` actor calls `GET /api/datasets/:id` (existing endpoint).
2. If 403/404 → resolves with `{ dataset_access_denied: true }` → machine transitions back to `session_active` with `context.resource` UNCHANGED.
3. If 200 + dataset's `project_id` matches J-002's `context.project.id` → calls `PATCH /api/sessions/:id { active_dataset_id }` → resolves `{ resource_type, resource_id, persisted: true }`.

**No new backend route** is required. The two existing routes (`get_dataset`, `update_session`) cover the full write path.

---

## 6. Composition with the frontend — RRv7 loaders + per-route scope (DWD-4)

> **Source contracts**: ADR-034 (RRv7 framework mode is the substrate; MR-0 plumbing just landed at HEAD 89bab77); ADR-029 §2 Option D (`useScope` hook); `frontend/app/routes.ts` (the 12-route declaration).

### 6.1 The root loader (Slice 1 prerequisite)

`frontend/app/root.tsx` today has **no root loader** (per the code survey). Slice 1 adds one:

```ts
// frontend/app/root.tsx — Slice 1 extension (DWD-4)

import type { LoaderFunctionArgs } from "react-router";
import { uiStateClient } from "./lib/ui-state-client.ts";

export async function loader({ request }: LoaderFunctionArgs) {
  const principal_id = derivePrincipalId(request);  // from X-User-Id (auth-proxy-injected) or JWT sub
  const j001 = await uiStateClient(request).getProjection("login-and-org-setup", `login-and-org-setup:${principal_id}`);
  if (j001.state !== "ready") {
    throw redirect("/login");  // or to wherever J-001 currently lands the user
  }
  return {
    active_scope_org: j001.active_scope.org_id,
    user_first_name: (j001.context.user as { display_name?: string }).display_name?.split(" ")[0] ?? "",
    principal_id,
  };
}

export function useJ001Scope() {
  return useRouteLoaderData<typeof loader>("root");
}
```

This is the foundation every J-002 loader builds on. Sequential ordering: J-001 projection FIRST, then (in J-002-territory routes) J-002 projection.

### 6.2 Per-route loader-graduation matrix (DWD-4)

The 12 declared routes in `frontend/app/routes.ts` graduate selectively per slice. **Library-mode routes stay client-only.** Per-route decisions:

| Route path | File | Slice | Loader graduation | Rationale |
|---|---|---|---|---|
| `/` (root) | `frontend/app/root.tsx` | **Slice 1** | YES — reads J-001 projection (§6.1) | Foundation for every other J-002-territory route. |
| `/projects/:projectId` | `routes/project-detail.tsx` | **Slice 1** | YES — reads J-002 projection with `intent_project_id = params.projectId`; emits `open_deep_link` event server-side BEFORE returning to FE | Closes US-204 the cold-deep-link case mechanically — `active_scope.project_id` is resolved by the loader, the FE renders the chip from `useLoaderData`, no flicker. |
| `/projects/:projectId/datasets/:datasetId` | `routes/project-detail.tsx` (`id: project-dataset-detail`) | **Slice 1** | YES — same as above with `intent_resource_id` + `intent_resource_type = "dataset"` | US-204 Example 5 (deep-link with intent_resource carries through). |
| `/` (index → `routes/chat.tsx`) | `routes/chat.tsx` | **Slice 2** | YES — reads J-002 projection; resolves last-used project per US-202 | Lands returning user in `session_list_visible` on first paint. |
| `/chat/:channelId` | `routes/chat.tsx` (`id: chat-with-channel`) | **Slice 2** | YES — reads J-002 projection with `intent_session_id = params.channelId` | Drives `resuming_session` from URL; per US-205 the loader's return value carries transcript + restored dataset on first paint. |
| `/sessions` | `routes/sessions.tsx` | **Slice 2** | YES — reads J-002 projection; on `session_list_visible` returns `context.session_list` + `context.session_list_next_cursor` for pagination | Per the journey YAML's `session.list` shared artifact, ownership is "Backend metadata_repository; J-002 reads-and-projects" — the Chats page is the full-list consumer, paginated client-side after the first page is loader-served. |
| `/projects` | `routes/projects.tsx` | **Slice 1** | YES — reads J-002 projection; uses `most_recent_session_per_project` + project list from J-002 projection (OQ-J002-3 resolution per DWD-4) | Per OQ-J002-3 ([handoff-design.md](../discuss/handoff-design.md) Luna's posture): "J-002 projection for routes inside the app-shell layout" — this includes `/projects`. The grid renders from the projection, not direct from `list_projects`, so scope-coherence is preserved. |
| `/login`, `/logout`, `/auth/callback`, `/org/create` | (J-001 routes) | not J-002 | NO | Already wired to J-001 by Phase 02 of frontend-coexistence. |
| `/table/:datasetId`, `/view/:viewId`, `/report/:reportId` | (J-003+ routes) | not J-002 | NO (stay library-mode) | Out of J-002 scope per D6; future J-003+ DISCUSS waves graduate them. |
| `/query-engines`, `/query-engines/:nodeId` | (admin) | not J-002 | NO | Admin routes; out of J-002 scope. |

**Slice ordering**: 5 J-002-territory route migrations happen across Slices 1 + 2 (Slice 1 = root + project-detail + projects-grid; Slice 2 = chat + chat/:channelId + sessions). Slices 3-6 don't migrate additional routes — they only extend existing loaders to fire new J-002 events (e.g., Slice 5's `switching_dataset_context` is driven by the chat-view component calling `uiStateClient.postJ002Event` on user interaction, NOT by a new loader).

### 6.3 The SSE cancellation contract (Slice 4 / US-207)

When the user clicks a different project, the FE must close the in-flight SSE stream BEFORE the new project's loader runs. The mechanism:

- The chat-view component (`frontend/src/ui/components/ChatView/` per the existing tree) holds an `EventSource` ref in a `useEffect`.
- The component's `useEffect` cleanup function calls `eventSource.close()` on unmount.
- RRv7's behavior on navigation: the leaf component for the prior route unmounts BEFORE the new route's components mount. (This is React Router's standard tree-replacement lifecycle.)
- Therefore: navigating from `/chat/:channelId` (Q4) to `/projects/:projectId` (Q3) unmounts the Q4 chat-view (closing SSE) BEFORE Q3's loader runs.

**No new abstraction**. The contract is satisfied by RRv7's existing lifecycle + the existing `useEffect` cleanup pattern.

**Acceptance-test surface**: Slice 4 DISTILL writes a scenario that asserts the agent's request log shows the SSE stream was closed before any agent call carrying Q3's project_id. The test uses the `harness.j002.assert_agent_received_scope(turn_index)` operation per US-208 + US-207 cross-cutting (the agent never receives a turn with mismatched `(project_id, session_id)`).

### 6.4 The composer-text preservation contract (Slice 3 / US-206)

When `error_recoverable` fires from `create_session` transient failure during `session_active_no_messages → first_message_sent → create_session_failed`, the FE's composer text must survive the transition. The mechanism:

- `useLoaderData` does NOT re-run for in-place state transitions — only on URL changes.
- The composer text lives in component-local state (`useState`), which survives state-transition re-renders.
- The "Try again" CTA re-fires `first_message_sent` with the same composer text — no re-typing required.

**No new abstraction**. The contract is satisfied by React's standard component-local-state model + the unchanged URL during the retry boundary.

### 6.5 Cross-tab session-list refresh (Slice 2 / US-203 Example 4)

A session created in Tab B must refresh Tab A's session list within 1 second. Today's `uiStateClient` has no SSE consumer. **Slice 2 adds a thin SSE consumer** to the chat-shell route (`/chat`):

- ADR-027 §1 commits to `GET /api/flows/{flow_id}/projection/stream` as a future SSE channel.
- Today this endpoint is **not implemented** in `ui-state/index.ts` (the code survey returned no `stream` route).
- **DWD-9 ratifies**: the projection-stream endpoint lands in Slice 2 DELIVER (not Slice 1). Slice 1 ships polling-as-fallback if the SSE endpoint is not ready; Slice 2 is the gated milestone.

The endpoint shape (Slice 2 DELIVER): a Hono SSE handler that subscribes to the Redis flow-event log key (`ui-state:project-and-chat-session-management:<principal_id>:events`) via Redis Streams `XREAD BLOCK`. On each new event, the handler rebuilds the projection (or sends an incremental delta — Slice 2 ships full projection per ADR-027 §4) and pushes it down the SSE channel. The FE subscribes via `EventSource` from the chat-shell route's `useEffect`.

**Cross-tab safety**: each tab opens its own SSE connection; both receive the same broadcast events. Tab A's list refreshes when Tab B's `POST /sessions` lands a new session row + J-002's `loading_session_list` re-fires (or the new session emits a `session_list_invalidated` FlowEvent — see DWD-9 for the chosen mechanism).

### 6.6 Library-mode interop (ADR-034 inheritance)

Routes NOT graduated to loaders (e.g., `/table/:datasetId`) continue to work as today. They are NOT J-002-territory; they receive `active_scope` from `useRouteLoaderData("root")` (J-001's `org_id`) but not from J-002's projection. If they need `project_id`, today they read from `useParams("projectId")` — which is on its way out per ADR-029 §2. Slice 4's lint rule (DWD-3) extends to forbid `useParams("projectId")` outside loader scope; library-mode routes that need it use a transitional `useJ002Scope()` hook that reads from a (post-Slice-2) React Context populated by the chat-shell loader. **This is the strangler-fig pattern from ADR-027 §"Migration of AuthContext.tsx consumers" applied to project_id.**

---

## 7. Projection shape extensions (DWD-9)

> **Source contract**: ADR-027 §4 (the `FlowProjection` envelope is the SSOT shape; FE + harness read identical JSON).

### 7.1 The `FlowProjection` envelope is unchanged

```ts
type FlowProjection = {
  flow_id: string;
  state: string;                    // J-002's state name (one of 14 — §2.4)
  context: Record<string, unknown>; // J-002's machine context (see §2.1)
  active_scope: ActiveScope;        // ADR-029 contract; J-002 populates project_id + resource_*
  sequence_id: number;
  last_event_at: string;
  correlation_id: string;
};
```

**Verbatim from `ui-state/lib/projection.ts:22-30`. No envelope change.** J-002 is a tenant of the same projection shape J-001 uses; the discriminator is `flow_id` (`"project-and-chat-session-management:<principal_id>"` vs `"login-and-org-setup:<principal_id>"`).

### 7.2 What lives in `context.*` for J-002

The `J002MachineContext` type from §2.1 IS the projection's `context` field. Specifically:

| Field | Populated when | Consumed by |
|---|---|---|
| `context.project: {id, name}` | `project_selected` entry | FE app-shell project chip; FE project-detail page header |
| `context.session_list: SessionSummary[]` | `session_list_visible` entry (first page) | FE recent-sessions nav (first 5); FE Chats page (first 30) |
| `context.session_list_next_cursor: string \| null` | same | FE Chats page pagination |
| `context.session_id: string \| null` | `session_active` entry | Agent's `thread_id` parameter; FE chat-view transcript binding |
| `context.transcript: TranscriptMessage[]` | `session_active` entry (from resume OR new-session-eager-create) | FE chat-view |
| `context.resource: {type, id}` | `session_active` entry; `switching_dataset_context` exit | FE chat-view gutter dataset chip; agent's `X-Active-Scope.resource_*` |
| `context.last_live_state` | `freeze` entry | TS harness; FE "Refreshing your session..." banner attribution |
| `context.most_recent_session_per_project` | `resolving_initial_scope` exit | J-002 last-used resolution (US-202); FE Projects grid sort hint |
| `context.underlying_cause_tag` | `error_recoverable`, `scope_mismatch_terminal` entry | FE named-diagnostic panels (closed-vocabulary copy variants) |
| `context.scope_reconciled_count`, `context.stale_intents_dropped_count` | various transitions | DEVOPS instrumentation; TS harness assertions |

### 7.3 The dispatch-table extension in `projection.ts`

`ui-state/lib/projection.ts:107-242` declares `EVENT_HANDLERS` as a strategy table. J-002 extends it with one entry per J-002 event type. Examples (DELIVER artifact):

```ts
// ui-state/lib/projection.ts — J-002 extensions (DWD-9; DELIVER Slice 1+)

const J002_EVENT_HANDLERS: Record<string, EventHandler> = {
  j002_resolution_started: (state, context, _event) => ({ state: "resolving_initial_scope", context }),
  project_selected: (_state, context, event) => {
    const p = event.payload as { project: { id: string; name: string } };
    return {
      state: "project_selected",
      context: { ...context, project: { id: p.project.id, name: p.project.name } },
    };
  },
  no_projects_displayed: (_state, context, _event) => ({ state: "no_projects_empty_state", context }),
  session_list_loaded: (_state, context, event) => {
    const p = event.payload as { items: SessionSummary[]; next_cursor: string | null };
    return {
      state: "session_list_visible",
      context: { ...context, session_list: p.items, session_list_next_cursor: p.next_cursor },
    };
  },
  // … 14 more J-002 handlers (one per event in the journey YAML's `emits` lists) …
};

// Merged into the existing EVENT_HANDLERS at the top of the file:
const EVENT_HANDLERS: Record<string, EventHandler> = {
  ...EXISTING_J001_HANDLERS,
  ...J002_EVENT_HANDLERS,
};
```

**The fold remains pure** (`projection.ts:251-258`'s `applyEvent` and `:260-303`'s `buildProjection` are byte-unchanged). The strategy-pattern grew by one bucket of entries.

### 7.4 The `active_scope` derivation for J-002

`projection.ts:280-293` today derives `active_scope` from `context.resolved_scope` (set by `deep_link_opened`) OR from `context.org`. **J-002 extends this**: when `context.project.id` is set AND `context.resolved_scope` is null, the active_scope is `{org_id, project_id: context.project.id, resource_type: context.resource.type, resource_id: context.resource.id}`. The derivation continues to be a pure function over context:

```ts
// projection.ts derivation — J-002 extension (DWD-9)
let scope: ActiveScope = EMPTY_SCOPE;
if (context.resolved_scope) {
  scope = context.resolved_scope;
} else if (context.project?.id) {
  // J-002 has a project context — derive from machine state
  scope = {
    org_id: context.org_id ?? "",
    project_id: context.project.id,
    resource_type: context.resource?.type ?? null,
    resource_id: context.resource?.id ?? null,
  };
} else if (context.org.id) {
  // Existing J-001 fallback
  scope = { org_id: context.org.id, project_id: null, resource_type: null, resource_id: null };
}
```

**Single source of truth invariant preserved**: the FE/harness/agent all read this same derived `active_scope` field from the projection. No parallel state.

---

## 8. ScopeResolver invariants — J-002's call sites

> **Source contract**: ADR-029 §1 invariants 1-5 + `ui-state/lib/active-scope.ts:80-142`.

The pure-function ScopeResolver at `active-scope.ts` is **byte-unchanged by J-002**. J-002 calls it at three explicit boundaries:

| Call site | Invariants exercised | Outcome on violation |
|---|---|---|
| `resolveInitialScope` actor in `resolving_initial_scope` state | I1 (org parity), I4 (cross-tenant project) | I4 violation → return `{cross_tenant: true}` → `scope_mismatch_terminal` (US-204) |
| `switchProject` actor in `switching_project` state | I1, I4 (the new project's tenant) | Same as above (US-207 cross-tenant edge) |
| `switchDatasetContext` actor in `switching_dataset_context` state | I3 (resource pair atomic), I4 (cross-tenant/cross-project dataset) | I3 violation degrades to project-only scope (no error); I4 violation → resolve with `{dataset_access_denied: true}` → transition back to `session_active` with prior `context.resource` (US-209) |

**No new invariant is introduced.** J-002 exercises invariants **I1, I3, I4** in new call sites; the resolver is correct by construction for those sites because it operates on `(route, jwt, machineContext)` triples and the existing invariants apply unchanged.

**Invariant I5 (stale-link reconciliation for project-rename-while-bookmarked) is NOT exercised by J-002 in PR-0.** I5's mechanism (`active-scope.ts:125-130`) requires the optional `machineContext.{bookmarked_project_name, current_project_name}` fields to be populated. J-002's machine context (§2.1's `J002MachineContext`) does NOT populate these fields, because none of US-201..US-210 describes a "project was renamed since the bookmark was saved" case — the J-002 deep-link failure modes are I4-shaped (cross_tenant, project_not_found, access_revoked), not I5-shaped (rename-drift). J-002's resolver call sites therefore pass the default empty `machineContext` (`active-scope.ts:83`).

The `scope_reconciled` FlowEvent referenced in the journey YAML for `switching_dataset_context` is the observability emission already produced by the existing `deep_link_opened` projection handler at `projection.ts:201-220` with `reconciled: false` — it is not an I5 emission. ([DWD-12 ratifies that future J-NNN flows can populate the I5 fields and exercise I5 without changing the resolver.](./wave-decisions.md))

---

## 9. Per-slice mapping (the design surface each slice touches)

> **Source contract**: `docs/feature/project-and-chat-session-management/discuss/slices/slice-{01..06}-*.md`.

| Slice | Design surfaces touched | Reversibility (rollback shape) |
|---|---|---|
| **Slice 1** — walking skeleton (US-201, US-202, US-204) | (1) New machine file `ui-state/lib/machines/project-and-chat-session-management.ts` with 5 states (`resolving_initial_scope`, `no_projects_empty_state`, `creating_project`, `project_selected`, `scope_mismatch_terminal`). (2) Orchestrator machine-registry refactor (DWD-8). (3) `projection.ts` dispatch-table extension for `resolution_started`, `project_selected`, `no_projects_displayed`, `project_creation_started`, `project_created`, `scope_mismatch_displayed`. (4) `frontend/app/root.tsx` root loader (§6.1). (5) Loaders on `routes/project-detail.tsx` and `routes/projects.tsx`. (6) `uiStateClient.getJ002Projection` + `postJ002Event` methods. | Delete the new machine file → orchestrator registry entry removal → J-002 actor never spawns → routes fall back to library-mode component-fetch behavior (today's shape). MR-sized revert. |
| **Slice 2** — session list + resume (US-203, US-205) | (1) Machine grows 3 states (`loading_session_list`, `session_list_visible`, `resuming_session`, `session_active`). (2) **Alembic migration 009** adds `session.active_dataset_id` column (DWD-2). (3) `update_session.py` allowlist extension. (4) Loaders on `routes/chat.tsx` (`/` index + `/chat/:channelId`) and `routes/sessions.tsx`. (5) Projection stream SSE endpoint at `/ui-state/flow/:machine/projection/stream` (DWD-9). (6) Projection dispatch-table extension for session-list/resume events. | Drop the migration → drop the use-case allowlist line → drop the SSE endpoint → drop the three loaders → J-002 stops surfacing session lists but Slice 1 keeps working. **Cross-slice gate**: Slice 2 cannot DELIVER until DWD-2 lands AND migration 009 is applied to all envs. |
| **Slice 3** — new session lifecycle (US-206) | (1) Machine adds `session_active_no_messages` state. (2) Projection dispatch-table extension for `session_welcome_displayed`, `session_active_reached`. (3) FE composer-state preservation contract (no code change required per §6.4 — relies on component-local state). | Remove the state from the machine — `new_session_clicked` falls through to current behavior (`session_active` via eager-create) per US-206 Edge cases reverting cleanly. |
| **Slice 4** — project switching + agent contract (US-207, US-208) | (1) Machine adds `switching_project` state. (2) `uiStateClient.activeScopeHeader` method + helper. (3) Loader extension: every loader fetch sets `X-Active-Scope` from projection. (4) **Agent middleware refactor** in `agent/lib/chat/handleChat.ts` (per §4). (5) Backwards-compat flag `SCOPE_HEADER_FALLBACK_ENABLED` with compile-time sunset. (6) ESLint rule extension (forbid manual `X-Active-Scope` sets outside `uiStateClient`). | Flag `SCOPE_HEADER_FALLBACK_ENABLED=true` permanently disables the header-only enforcement (the legacy body path keeps working). Sunset date can be pushed via one-line edit if legacy clients aren't migrated; **the rollback shape is "extend the migration window," not "revert the slice."** |
| **Slice 5** — dataset context switching (US-209) | (1) Machine adds `switching_dataset_context` state + 2 event handlers in `session_active`. (2) Projection dispatch-table extension for `switching_dataset_context_started`, `dataset_attached`, `dataset_access_denied`. (3) Chat-view component gains one-line emit: `j002.postEvent({type: "dataset_resolved_by_agent", ...})` on `data-agent-request` typed-part handler. (4) Backend's `update_session.py` write of `active_dataset_id` (Slice 2 prerequisite). | Remove the state → the FE's `data-agent-request` handler reverts to today's behavior (re-submits chat turn with new contextId on the body; cross-tenant safety degrades to today's level — acceptable transient). |
| **Slice 6** — cross-machine FREEZE/THAW (US-210) | (1) Machine declares top-level `on.FREEZE` + the `freeze` side-state with `on.THAW → last_live_state` history target. (2) Projection dispatch-table extension for `j002_frozen`, `j002_thawed`, `stale_intent_dropped_after_thaw`. (3) Stale-intent filter at REPLAY time per DWD-7. **The orchestrator's broadcast logic is BYTE-UNCHANGED** (`ui-state/lib/orchestrator.ts:327-411` enumerates all spawned actors regardless of machine; J-002's actor is added by Slice 1's machine registry, so by Slice 6 the broadcast already reaches J-002). | Remove the FREEZE handler from the J-002 machine → mid-mutation token expiries surface as generic 401 errors (today's UX baseline) → reverts to pre-J-002 behavior for those edge cases without disturbing the substrate. |

**Sequencing constraint**: Slices must DELIVER in order 1 → 2 → 3 → 4 → 5 → 6 because:
- Slice 2 depends on Slice 1's `project_selected` state.
- Slice 3's `session_active_no_messages` is reached from Slice 2's `session_list_visible`.
- Slice 4's `switching_project` invalidates `session_id` (Slice 2's) and `resource_*` (Slice 5 — but the invalidation works against a NULL value before Slice 5 lands).
- Slice 5 writes `session.active_dataset_id` which Slice 2 reads on resume — Slice 5 effectively closes the loop Slice 2 opens (the column is added by Slice 2's migration but reads NULL until Slice 5 ships the write path).
- Slice 6 needs Slices 1-5's mutations to FREEZE.

---

## 10. Error boundaries + recoverable states

J-002 inherits J-001's `error_recoverable` shape verbatim. Three new failure modes (per the journey YAML's `failure_modes` block) are recoverable; one is terminal-recoverable.

| Failure mode | State entered | Cause tag | UX | Retry contract |
|---|---|---|---|---|
| `j002_no_projects_in_org` | `no_projects_empty_state` | `no_projects` | Welcoming "Create your first project" panel | Not an error — primary CTA is "Create project" |
| `j002_stale_deep_link_cross_tenant` | `scope_mismatch_terminal` | `cross_tenant` | "This project is no longer accessible" + correlation_id + "Back to projects" CTA | "Back to projects" re-enters `resolving_initial_scope` with intent cleared |
| `j002_stale_deep_link_project_not_found` | `scope_mismatch_terminal` | `project_not_found` | Same panel; different copy variant tag | Same |
| `j002_stale_deep_link_access_revoked` | `scope_mismatch_terminal` | `access_revoked` | Same panel; different copy variant tag | Same |
| `j002_session_not_found` | `session_list_visible` (graceful) | (no panel — silent recovery) | The session disappears from the list on next projection refresh | None — the list IS the recovery surface |
| `j002_dataset_access_denied` | `session_active` (graceful — `context.resource` UNCHANGED) | `dataset_access_denied` | Inline copy "you don't have access to that dataset" in chat input gutter | None — the prior dataset stays attached |
| `j002_list_sessions_transient_failure` | `error_recoverable` | `list_sessions_degraded` | "We couldn't load your sessions. Try again." + correlation_id | `retry_clicked` re-enters `loading_session_list` |
| `j002_create_project_validation_failed` | `no_projects_empty_state` | (no panel — inline form error) | Inline form-field error | The user edits and re-submits |
| `j002_token_expired_during_mutation` | `freeze` (US-210) | (no panel — banner overlay) | "Refreshing your session..." banner; prior state's last paint visible underneath | None — silent recovery via orchestrator replay |
| `j002_replay_abandoned` (5s timeout, no THAW) | `error_recoverable` | `replay_abandoned` | "We couldn't complete that action — try again." + correlation_id | `retry_clicked` re-enters originating state via `last_live_state` |

**The `error_recoverable → originating state` retry pattern** is XState v5's "history target" pattern. Per US-210 Example 4 the `replay_abandoned` case lands here too — the originating user-action's payload is preserved in `context.pending_*` for the retry to use without prompting.

**The `error_recoverable.retry_budget` from J-001** (3 user retries before escalation to `error_terminal`) is **NOT inherited by J-002** in PR-0. J-002's `error_recoverable` is single-tier — every retry re-enters the originating state. The J-001 escalation pattern is appropriate for auth flows (where infinite-retry suggests a fundamentally broken setup); J-002's transient failures (network, backend 503) are stateless and rare-but-bounded enough that an explicit escalation tier is overkill. ([DWD-12 ratifies; if a future operational signal shows J-002 retry-storms, the escalation tier can be added without further structural change.](./wave-decisions.md))

---

## 11. Reversibility per slice

The slice-by-slice rollback shapes are summarized in §9 above. Cross-slice observations:

1. **Slice 1 is the only slice whose rollback truly removes J-002.** Subsequent slices roll back to "J-002 with less behavior," not to "no J-002."
2. **Slice 4 (agent contract) is the only slice with a flag-gated rollback shape.** The `SCOPE_HEADER_FALLBACK_ENABLED` env flag inverts the precedence: with `true`, body-`project_id` is read first; with `false`, header-only enforcement. The sunset compile-time check is the forcing function ensuring the flag doesn't survive forever (R8 mitigation).
3. **Slice 2's Alembic migration is forward-only in practice.** The `downgrade()` function works mechanically, but rolling back the migration after Slice 5 has populated `active_dataset_id` data will lose user state. Rollback policy (DWD-2): the migration's `downgrade()` is a development-environment-only escape hatch; production migrations roll forward.
4. **Slice 6's rollback** removes the FREEZE handler from J-002 — the orchestrator's broadcast still fires; J-002's actor simply doesn't acknowledge `FREEZE`, so the actor continues executing during the freeze window. This degrades to today's behavior (mid-mutation 401 → generic error) — undesirable but not catastrophic.

The **per-route reversibility** from ADR-034's MR-0 carries through: any route's loader can be deleted, reverting it to library-mode. The route's component continues to work (it re-establishes today's client-side fetch behavior). The strangler-fig holds.

---

## 12. Quality attributes (ISO 25010)

| Attribute | Strategy | Verification |
|---|---|---|
| **Performance** | (1) Last-used resolution is bounded by `N × list_sessions(limit=1)` for the user's N projects (typically <10 — Luna's posture in OQ-J002-5 says "lazy is fine"). (2) Projection endpoint p95 ≤ 80ms per ADR-027 §"Performance" inheritance. (3) SSE projection-stream for cross-tab refresh avoids polling. (4) RRv7 loaders run server-side → eliminates the FE flicker that today's client-side fetch causes for deep-links. | K-J002-2 (deep-link <300ms p95); K-J002-1 (first-paint ≤800ms p95); K-J002-4 (project switch <300ms p95). |
| **Reliability** | (1) Earned-Trust probes (ADR-027 §6) cover all adapters; the orchestrator probes Redis + backend before serving traffic. (2) Capability-presence dispatch (ADR-018 inheritance) — if Redis is unreachable, the noop adapter still serves projection reads (degraded but not failed). (3) Replay buffer's 5s/16-event ceiling prevents memory exhaustion under freeze pathology. | Substrate inheritance from J-001 DELIVER — no new acceptance test surface. |
| **Security** | (1) ScopeResolver invariants 1-5 (ADR-029) enforce JWT-claim parity at every projection request. (2) `X-Active-Scope.org_id` mismatch with `X-Org-Id` (auth-proxy-injected) → 403 (US-208 Example 5). (3) The `update_session` allowlist (DWD-2) prevents arbitrary column writes — only `{title, last_active_at, active_dataset_id}` are settable. (4) Cross-tenant dataset attach → 403 via existing `authorize_project_access` backend dep. | K-J002-5 (100% scope-validated turns; 0 cross-tenant turns); acceptance test asserts cross-tenant deep-link → `scope_mismatch_terminal`. |
| **Maintainability** | (1) The machine-registry refactor (DWD-8) makes J-003+ addition mechanical. (2) The projection's strategy-pattern (one event handler per type) makes new event types localized changes. (3) All J-002 transitions emit `DomainEvent`s (ADR-014 inheritance); the projection is the read shape. (4) ESLint rule (DWD-3) forbids drift back to manual `useParams` + parallel state. | `dependency-cruiser` enforcement per ADR-027 §7 covers the import-graph; the lint covers the FE re-derivation surface. |
| **Testability** | (1) The TS `UserFlowHarness` grows a `harness.j002.*` namespace (per the journey YAML `testing_surface.ts_harness.operations` list — 12 operations). (2) `assert_scope({...})` reads the same projection the FE consumes — single SSOT. (3) Adapter injection via XState's `.provide({ actors: { ... } })` enables pure unit tests (no Redis, no backend). | DISTILL writes ~55 pytest-bdd scenarios; the TS harness is the driver. |
| **Observability** | (1) Every J-002 FlowEvent carries `correlation_id` per the journey YAML emits blocks. (2) The DEVOPS instrumentation list in `outcome-kpis.md` §"Handoff to DEVOPS" enumerates 17 events (8 FE + 2 agent + 5 ui-state + 2 cross-cutting). (3) `last_used_resolution_degraded`, `scope_reconciled`, `stale_intent_dropped_after_thaw` give visibility into the silent-degradation cases. | K-J002-1..K-J002-6 instrumentation; same telemetry pipeline as J-001. |
| **Portability** | J-002 is pure TypeScript on Node; no new platform-specific APIs. Compose acceptance test (per ADR-016 mirror) verifies the J-002 endpoints are reachable through auth-proxy byte-identically in compose and CI. | Compose acceptance gate (DEVOPS scope). |

---

## 13. Reuse Analysis (HARD GATE)

Per the nw-design skill's mandatory step 5 (RCA F-1), every J-002 architectural concern is decision-gated against existing surfaces. Default is **EXTEND**; **CREATE NEW** requires justification beyond complexity.

| Existing component | File | Overlap with J-002 concern | Decision | Justification |
|---|---|---|---|---|
| `FlowOrchestrator` | `ui-state/lib/orchestrator.ts` | Spawns flow actors; broadcasts FREEZE/THAW; owns replay buffer | **EXTEND** | Add machine-registry strategy table (DWD-8) replacing hardcoded `if (input.machine !== ...)` branch. ~15 LOC change. CREATE NEW orchestrator would be ~600 LOC duplicate. |
| `LoginAndOrgSetupMachine` | `ui-state/lib/machines/login-and-org-setup.ts` | Per-flow XState v5 state-chart with FREEZE/THAW handlers | **CREATE NEW** sibling file `project-and-chat-session-management.ts` | ADR-028:46-48 forbids machine-to-machine imports. The two flows are independent actors per the actor model. Reuse via shared types only (`MachineContext`, `ActiveScope`, `ResourceType`). |
| `buildProjection` + `EVENT_HANDLERS` | `ui-state/lib/projection.ts:107-242` | Pure fold from `FlowEvent[]` to `FlowProjection` | **EXTEND** | Add J-002 event handlers to the same `EVENT_HANDLERS` dispatch table. The strategy-pattern is built for this. ~16 new entries; 0 changes to `applyEvent` / `buildProjection`. |
| `resolveActiveScope` | `ui-state/lib/active-scope.ts:80-142` | Pure-function scope resolution per ADR-029 invariants 1-5 | **REUSE VERBATIM** | All five J-002 call sites pass the same `(route, jwt, machineContext)` triple shape. Zero changes to the resolver. |
| `FlowEventLog` port + Redis adapter | `ui-state/lib/persistence/redis.ts` | Append-only event log per ADR-018 dispatch | **REUSE VERBATIM** | J-002 uses a new key prefix (`ui-state:project-and-chat-session-management:<principal_id>:events`) but the port is unchanged. |
| `FlowProjection` envelope shape | `ui-state/lib/projection.ts:22-30` | Wire format: `{flow_id, state, context, active_scope, ...}` | **REUSE VERBATIM** | J-002 is a second tenant of the envelope. `context` is opaque to the envelope, so flow-specific shape is invisible at the wire layer. |
| `uiStateClient` | `frontend/app/lib/ui-state-client.ts` | HTTP client to ui-state tier | **EXTEND** | Add 3 methods (`getJ002Projection`, `postJ002Event`, `activeScopeHeader`). ~30 new LOC. The existing `getProjection` method stays for J-001. |
| `frontend/app/root.tsx` | same | RRv7 root component | **EXTEND** | Add a `loader` export (Slice 1; §6.1). The existing component body stays unchanged. ~25 LOC added. |
| `agent/lib/chat/handleChat.ts` | same | Chat-turn entry point | **EXTEND** | Add `extractActiveScope` helper + refactor the body destructure to honor header-first; ~50 LOC delta. **DO NOT** convert to Hono middleware (per §4.4 rationale). |
| `update_session` use case | `backend/app/use_cases/session/update_session.py` | Session metadata writes | **EXTEND** | Add `"active_dataset_id"` to the allowlist; one-line change. No new use case. |
| Session SQLAlchemy model | `backend/app/repositories/metadata/session_record.py` | Session row schema | **EXTEND** | Add `active_dataset_id: Mapped[str \| None]` column. Migration 009 (Slice 2). |
| `frontend/app/lib/ui-state-client.ts` (header writer for X-Active-Scope) | same | Outbound-request header setting | **CREATE** new method `activeScopeHeader(projection): string` on the SAME helper | The helper is the single writer per DWD-3 + US-208 + ADR-029 §4 lint rule. Putting it on `uiStateClient` keeps the writer co-located with the projection it derives from. |
| ScopeResolver fn signature | `ui-state/lib/active-scope.ts:80` | `(route, jwt, machineContext) → ScopeResolution` | **REUSE VERBATIM** | The new J-002 call sites need the same triple shape; no signature change. |
| Redis Streams `XREAD BLOCK` consumer pattern | `ui-state/lib/persistence/redis.ts` (used today for XADD/XRANGE writes; reads are XRANGE-only) | SSE projection-stream endpoint (Slice 2, DWD-9) | **EXTEND adapter** with one new method `subscribe(key, since: sequenceId): AsyncIterable<FlowEvent>` | Idiomatic Redis Streams pattern (`XREAD BLOCK`). Adapter probe extends to cover the subscribe path. |
| TS `UserFlowHarness` | `tests/acceptance/user-flow-state-machines/.../harness.ts` (J-001 deliverable) | Headless flow driver | **EXTEND** with `harness.j002.*` namespace | The harness reads the same projection endpoint J-002's FE reads; adding a namespace is mechanical. Per journey YAML's `testing_surface.ts_harness.operations` list. |
| Python `DatasetLayerHarness` | `backend/tests/integration/dataset_layer/harness.py` | Backend+agent integration driver | **EXTEND** with `chat_turn_with_scope_header(scope, message)` method per US-208 acceptance | The new method is one method on the existing class; no fork. |

**Reuse summary**: J-002 introduces exactly **3 new files** (`project-and-chat-session-management.ts` machine; `agent/lib/chat/scope.ts` helper; `backend/migrations/versions/009_add_session_active_dataset_id.py`) and **9 file extensions**. Net new abstractions: zero. Net new ports: zero. Net new adapters: zero (the SSE-subscribe is a method extension on `RedisFlowEventLog`, not a new adapter).

**No CREATE NEW decision lacks justification.** The two CREATE NEW entries (the J-002 machine file; the agent scope helper) are each forced — by ADR-028:46-48 (machine independence) and by handleChat's existing structure respectively. No "extend would create too much coupling" handwaves are present.

---

## 14. What this DESIGN does NOT do

For DESIGN-wave anti-scope hygiene (per nw-design skill's "Don't add features…" guidance):

- **No new ADR.** J-002 fits in 027/028/029/030/034. If implementation surfaces a need (e.g., the SSE-subscribe adapter shape is more substantial than anticipated), DELIVER may propose ADR-035 — but DESIGN does not pre-bake one.
- **No implementation.** The machine file, the migration, the agent middleware are all DELIVER artifacts. DESIGN ships the contracts and the sketches.
- **No acceptance tests.** DISTILL.
- **No production code changes.** The repo is unchanged by DESIGN; the document tree is the deliverable.
- **No J-003+ design surface.** J-002 only.
- **No re-litigation of DISCUSS D1-D12.** The 12 binding decisions are inherited verbatim.

---

## References

- DISCUSS handoff: `docs/feature/project-and-chat-session-management/discuss/handoff-design.md`
- DISCUSS wave-decisions D1–D12: `docs/feature/project-and-chat-session-management/discuss/wave-decisions.md`
- Journey YAML (state contract): `docs/feature/project-and-chat-session-management/discuss/journey-project-and-chat-session-management.yaml`
- Per-story AC: `docs/feature/project-and-chat-session-management/discuss/stories/US-{201..210}.md`
- Carpaccio slice briefs: `docs/feature/project-and-chat-session-management/discuss/slices/slice-{01..06}-*.md`
- Outcome KPIs: `docs/feature/project-and-chat-session-management/discuss/outcome-kpis.md`
- J-001 design template: `docs/evolution/2026-05-12-user-flow-state-machines/design/application-architecture.md`
- ADRs: ADR-014, ADR-015, ADR-016, ADR-018, ADR-027, ADR-028, ADR-029, ADR-030, ADR-031 §7, ADR-034
- Sibling DESIGN artifacts (this wave): `wave-decisions.md`, `c4-diagrams.md`, `handoff-design-to-distill.md`
