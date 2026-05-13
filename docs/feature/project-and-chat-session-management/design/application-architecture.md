# Application Architecture — `project-and-chat-session-management` (J-002)

> **Wave**: DESIGN (propose mode)
> **Date (original)**: 2026-05-13
> **Date (SRP amendment)**: 2026-05-13 (same day; post-MR-1 ship + post-SRP review)
> **Architect**: nw-solution-architect (DESIGN wave for J-002; also DESIGN amendment for the SRP-driven split)
> **Inherited from DISCUSS**: 18 artifacts under `docs/feature/project-and-chat-session-management/discuss/` (10 stories + 6 slices + journey YAML + 6 KPIs + JTBD + shared-artifacts + wave-decisions D1–D12 + product-owner APPROVED verdict)
> **Inherited from J-001 DESIGN**: `docs/evolution/2026-05-12-user-flow-state-machines/design/{application-architecture, wave-decisions, system-architecture, c4-diagrams}.md` — substrate is amortized; J-002 plugs into it.
> **Inherited ADRs (binding)**: ADR-014 (ChatEvent stratification), ADR-015 (presentation-state log), ADR-016 (auth-proxy ingress), ADR-018 (capability-presence dispatch), **ADR-027** (ui-state tier + Remix→RRv7 framework), **ADR-028** (XState v5 actor model — IMMUTABLE), **ADR-029** (`active_scope` propagation), **ADR-030** (topology + scaling), **ADR-031 §7** (auth path), **ADR-034** (frontend coexistence via RRv7 framework mode).
> **Companion deliverables (this wave)**: `wave-decisions.md` (DWD-1..DWD-13), `c4-diagrams.md`, `handoff-design-to-distill.md`, `review-by-software-crafter-srp.md` (binding input for the amendment).

---

## Preamble — SRP amendment (2026-05-13)

This document was originally authored as the DESIGN for **one** XState machine, `project-and-chat-session-management`, carrying 14 states across 5 behavioral domains. After MR-1 shipped (`cd4103e`) — the substrate landing 5 of the 14 states — an SRP review (`review-by-software-crafter-srp.md`) flagged the single-machine shape as **AT RISK by MR-6** because the future 9 states span 4–5 distinct behavioral domains that would force divergent change and feature envy.

**The DESIGN is now amended.** The machine is split into TWO sibling machines under the ADR-028 actor model:

- **`project-context`** — owns "Which project am I in?" (8 states; owns `org_id` + `project_id` halves of `active_scope`).
- **`session-chat`** — owns "What's happening in my current session?" (9 states; owns `resource_*` half of `active_scope` and the chat-emitting states).

Both are spawned by the orchestrator. Neither imports the other (ADR-028:46–48). Coordination is via a new orchestrator broadcast hook `project_ready`, analogous to today's `j001_ready` hook. **DWD-13 is the binding decision record**; this document narrates the architecture under that decision.

**Convention for future flow machines** (RATIFIED in DWD-13): one cohesive responsibility per state machine; coordinate via orchestrator broadcast hooks. Composite names ("X-and-Y") are a smell unless "and" denotes a strict sequence dependency (J-001's `login-and-org-setup` is the precedent; JWT reissue MUST precede `ready`). See ADR-028 + DWD-13 for the cite path future DESIGNs should use.

**What the amendment touches in this document**:
- §1 (composition) — updated to reflect TWO machines + an additional broadcast hook + two key prefixes.
- §2 (the machine) — restructured as §2A (project-context) + §2B (session-chat) + §2C (cross-machine composition, lifting from old §3).
- §3 (cross-machine composition) — now covers BOTH the J-001→J-002 and J-002-internal (project-context ↔ session-chat) coordination contracts.
- §4 (agent contract) — unchanged in spirit; the `uiStateClient.activeScopeHeader` writer composes from BOTH J-002 projections instead of one.
- §5 (backend) — unchanged.
- §6 (frontend) — updated to fetch BOTH projections in each loader and compose.
- §7 (projection shape) — TWO `FlowProjection` envelopes, one per machine; envelope shape preserved (DWD-9 reaffirmed).
- §9 (per-slice mapping) — adds an MR-1.5 row (refactor); updates which machine each later MR touches.
- §10 (error boundaries) — clarifies that each machine has its OWN `error_recoverable`.
- §13 (Reuse Analysis) — updates the decisions about machine reuse and the new orchestrator hook.

Sections not listed above are unchanged. **No user-story acceptance criterion is amended.** The journey YAML's 14 states are preserved; they are partitioned across two machines.

---

## 0. TL;DR

J-002 is a **brownfield extension** of the actor-model substrate ratified by ADRs 027–030 (and refined by ADR-034). The substrate cost is amortized. J-002 adds, in order of architectural significance:

1. **Two NEW sibling machines** (per DWD-13 SRP amendment) at `ui-state/lib/machines/project-context.ts` and `ui-state/lib/machines/session-chat.ts`. Together they carry the journey YAML's 14 narrative states (12 named + `error_recoverable` per machine + `freeze` per machine). project-context owns 8 states (project-resolution + project-creation + project-switching + scope-mismatch + freeze/error); session-chat owns 9 states (session-list + resume + new-session + active + dataset-switch + freeze/error + the initial `waiting_for_project` state). Composed with J-001 via the orchestrator; neither machine imports the other (ADR-028:46-48).
2. **Orchestrator coordination hooks** — TWO broadcast hooks: existing `j001_ready` (login → project-context) + NEW `project_ready` (project-context → session-chat). Both follow the same `priorState`-watcher pattern; both are pure additives to the orchestrator. The MachineRegistry (DWD-8) gains an entry per machine (3 entries total: `login-and-org-setup`, `project-context`, `session-chat`).
3. **A session schema delta** — single `active_dataset_id` column on the `sessions` table (resolves **OQ-J002-1**, Option A). One Alembic migration; `update_session.py` allowlist extension. Owned by session-chat.
4. **The first end-to-end exercise of ADR-029 §4's agent-scope contract** — the `X-Active-Scope` request header becomes the EXCLUSIVE source of `(org_id, project_id, resource_*)` for `agent/lib/chat/handleChat.ts`. The body's `project_id` field becomes a one-release fallback with a compile-time sunset (resolves **D11** and **US-208 R8**). The FE's `uiStateClient.activeScopeHeader` composes the header from BOTH J-002 projections (project-context provides org_id+project_id; session-chat provides resource_*).
5. **RRv7 framework-mode route migrations** — 7 J-002-territory routes graduate to loader-bearing modules across 5 files (`root.tsx`, `routes/projects.tsx`, `routes/project-detail.tsx` [two route IDs share this file], `routes/chat.tsx` [two route IDs share this file], `routes/sessions.tsx`). Each loader reads BOTH J-002 projections via the extended `frontend/app/lib/ui-state-client.ts` helper. Per DWD-4 the migration is staged across Slices 1 + 2.
6. **Cross-machine FREEZE/THAW participation** — BOTH J-002 machines declare a top-level `FREEZE` handler with their own `last_live_state` field + `freeze` side-state. The orchestrator's broadcast logic (already in `ui-state/lib/orchestrator.ts:54-56,161-192,796-820`) is byte-unchanged — it enumerates all spawned actors; both J-002 actors receive the broadcast naturally. The replay buffer is per-flow; doubling the flow count per principal is well within the planning-horizon budget (ADR-030 §3).

**No new ADR is needed** (DWD-12 reaffirmed). J-002 fits cleanly inside the existing 027/028/029/030/034 envelope. The three DESIGN-level decisions DISCUSS deferred (OQ-J002-1 storage shape; OQ-J002-6 stale-intent filter) plus the SRP-driven machine split are resolved in `wave-decisions.md` DWD-2, DWD-7, and DWD-13.

**Convention ratified** (DWD-13): one bounded responsibility per state machine; coordinate via orchestrator broadcast hooks. Composite names are a smell unless "and" denotes a strict sequence dependency (per J-001 precedent).

**The North Star (K-J002-4 — atomic project switching with zero cross-tenant chat-turns)** is mechanically retired by the composition of (a) project-context's `switching_project` state, (b) the `project_ready` re-broadcast invalidating session-chat's `session_id`+`resource_*` atomically, (c) the FE SSE cancellation contract on unmount, and (d) the agent's header-only scope read with JWT-vs-header `org_id` parity check.

---

## 1. Composition with the existing substrate (what J-002 inherits unchanged)

J-002 is the **second and third** machines plugged into the actor tree at `ui-state/index.ts` (per DWD-13: two machines per J-002 flow). Every primitive J-002 needs already exists. The mandatory orientation matrix:

| Substrate concern | Status today | J-002 impact (post-DWD-13 amendment) |
|---|---|---|
| XState v5 actor model (ADR-028) | Live; one machine (`login-and-org-setup`) registered | J-002 declares TWO machines (`project-context`, `session-chat`) via the same `setup({...}).createMachine(...)` shape; orchestrator spawns sibling actors; they communicate ONLY via orchestrator broadcasts (`j001_ready`, **`project_ready`** [NEW], `FREEZE`, `THAW`) per ADR-028:46-48. |
| Flow event log + Redis dispatch (ADR-018 inheritance) | Live; key prefix `ui-state:{flow_id}:events`; `selectFlowEventStore` dispatch | J-002 reuses the same `FlowEventLog` port; TWO new key prefix values: `ui-state:project-context:<principal_id>:events` AND `ui-state:session-chat:<principal_id>:events`. **No new env var, no new dispatch.** Per ADR-030 §6's `flow_id` schema, one log per `(machine, principal)` pair. |
| Projection contract (ADR-027 §4) | Live; pure function `FlowEvent[] → FlowProjection` at `ui-state/lib/projection.ts` | J-002 extends the `EVENT_HANDLERS` dispatch table at `projection.ts:107-242` with event types from BOTH machines. The projection-level `active_scope` field continues to be derived from each machine's `context.*` per ADR-029 §1. The `FlowProjection` envelope shape is **unchanged** (DWD-9 reaffirmed); per-machine projections are independent envelopes, one per `flow_id`. The FE / TS harness compose the two envelopes into the unified J-002 view via `uiStateClient` helpers; the wire format is byte-identical to a J-001-style single-flow projection per envelope. |
| ScopeResolver (ADR-029 §1 invariants 1–5) | Live; pure fn at `ui-state/lib/active-scope.ts:80-142` | J-002 calls the resolver verbatim from BOTH machines. project-context's `resolveInitialScope`, `switchProject` actors hit invariants 1 + 4; session-chat's `switchDatasetContext` actor hits invariants 1 + 3 + 4. **The resolver itself is NOT modified by J-002.** What J-002 adds is *call sites* — the new machines emit `deep_link_opened` events that flow into the existing `EVENT_HANDLERS["deep_link_opened"]` reducer, and project-context's `switching_project` state emits a `scope_reconciled` event when mid-session URL change reconciles. |
| Orchestrator (`ui-state/lib/orchestrator.ts`) | Live; supervises actor tree; broadcasts FREEZE/THAW; owns 5-second/16-event replay buffer; owns the `priorState` watcher and the `j001_ready → beginIfNotStarted` hook for project-context (already shipped) | The orchestrator gains a **second broadcast hook**: `project_ready` (fires on project-context → `project_selected`; receivers: session-chat). The `MachineRegistry` (DWD-8) gains the `session-chat` entry — three entries total: `login-and-org-setup`, `project-context`, `session-chat`. The FREEZE/THAW broadcast logic and the replay buffer are **byte-unchanged** — they enumerate all spawned actors regardless of machine type. |
| Auth-proxy ingress (ADR-016 + ADR-031 §7) | Live; sole production ingress | J-002's projection endpoint URL family becomes TWO families: `/ui-state/flow/project-context/{begin,event,projection,open-deep-link,projection/stream}` and `/ui-state/flow/session-chat/{begin,event,projection,projection/stream}`. Auth-proxy's existing `/ui-state/*` forward rule needs no change (it is path-prefix wildcard per ADR-030 §1). RRv7 loaders read `request.headers.get('Authorization')` and forward Bearer per ADR-031 §7 (`web-ssr` substituted for `ui-presentation` per ADR-034). |
| RRv7 framework mode (ADR-034) | MR-0 plumbing landed (Phase 03 just merged at HEAD 89bab77); five existing routes are library-mode; `app/lib/ui-state-client.ts` exists but dormant | J-002 graduates 5 routes from library-mode to framework-mode (loader exports). The `uiStateClient` helper grows methods for BOTH machines (`getProjectContextProjection`, `getSessionChatProjection`, `postProjectContextEvent`, `postSessionChatEvent`) plus a `getJ002Projection` composer that reads both and merges. Loaders set `X-Active-Scope` on outgoing fetches via the composer. **`frontend/app/root.tsx` adds a root loader** that reads J-001's projection for `active_scope.{org_id}` (Slice 1 prerequisite — see §6.1). |
| Agent chat brain (D8 carried) | Live; `agent/lib/chat/handleChat.ts:75` reads `project_id` from request body unconditionally | J-002 adds **scope-extraction middleware** (one function, ~30 LOC) at the start of `handleChat`. The middleware reads `X-Active-Scope`, validates `org_id` vs `X-Org-Id`, validates `project_id` non-null, and (during the migration window) falls back to body `project_id` while emitting `scope_header_fallback_used`. **The chat-turn streaming, the Groq SSE, the tool dispatch, the ADR-015 directive log, and the `pipeChatStream` typed-part interception are all unchanged.** The agent does NOT know about the J-002 split — it reads from a single composed header value (the FE composes from two projections before fetch). |

The **net new infrastructure cost is three source files, one Alembic migration, one orchestrator-registry refactor (3 entries), TWO orchestrator broadcast hooks (one is new: `project_ready`), one agent middleware, one root-loader, five route-loader migrations, four uiStateClient method extensions, and one TypeScript shared scope-type re-export**. The "third source file" relative to the pre-amendment count is the split — the original DESIGN counted one machine file; the amendment counts two. Everything else is precedent.

---

## 2. The J-002 machines — two XState v5 statechart sketches (post-DWD-13 SRP amendment)

> **Source contract**: `docs/feature/project-and-chat-session-management/discuss/journey-project-and-chat-session-management.yaml` (12 named states + side-states; IMMUTABLE per DISCUSS D6).

This section maps the journey YAML's 14 narrative states to concrete XState v5 transitions across **two cohesive sibling machines** (per DWD-13). Each state remains a flat (non-parallel) sibling within its owning machine; DWD-1 in `wave-decisions.md` ratifies flat-compound over parallel-region within EACH machine.

**The two machines** (DWD-13):

| Machine | File (post-MR-1.5 refactor) | States | Behavioral responsibility |
|---|---|---|---|
| `project-context` | `ui-state/lib/machines/project-context.ts` | 8 | "Which project am I in?" — initial scope resolution, project creation, project switching, scope-mismatch terminal, plus error_recoverable + freeze. |
| `session-chat` | `ui-state/lib/machines/session-chat.ts` | 9 | "What's happening in my current session?" — waits for project_ready then loads + resumes + runs the session, attaches datasets, plus error_recoverable + freeze. |

There is no concurrent sub-region in either machine's behavior. XState's single-event-at-a-time semantics handle the concurrency cases (US-209 Example 5; concurrent dataset picks).

**State partition** (the 14 narrative + 2 cross-cutting states from the journey YAML, distributed across the two machines):

| Journey YAML state | Owning machine | Notes |
|---|---|---|
| `resolving_initial_scope` | **project-context** | Initial state of project-context; entry from J-001 `j001_ready`. |
| `no_projects_empty_state` | **project-context** | Project-creation onboarding. |
| `creating_project` | **project-context** | Invoke `createProject`. |
| `project_selected` | **project-context** | Project context settled. Orchestrator broadcasts `project_ready` on entry. |
| `loading_session_list` | **session-chat** | Invoke `loadSessionList`. Entered from `waiting_for_project` on `project_ready`, AND from a re-broadcast of `project_ready` after project switch. |
| `session_list_visible` | **session-chat** | Session list visible UI. `no_sessions_empty_state` collapses into this per DWD-1 (derived UI predicate). |
| `resuming_session` | **session-chat** | Invoke `resumeSession`. |
| `session_active_no_messages` | **session-chat** | New-session welcome. |
| `session_active` | **session-chat** | Session running. |
| `switching_dataset_context` | **session-chat** | Invoke `switchDatasetContext`. Returns to `session_active`. |
| `switching_project` | **project-context** | Invoke `switchProject`. Settles into `project_selected` → re-broadcasts `project_ready` → session-chat invalidates `session_id`+`resource_*`. |
| `scope_mismatch_terminal` | **project-context** | Terminal-recoverable; "Back to projects" re-enters `resolving_initial_scope`. |
| `error_recoverable` | **both (one per machine)** | Each machine has its own; never shared. Retry semantics scope to the owning machine's user actions. |
| `freeze` | **both (one per machine)** | Each declares top-level `on.FREEZE` + `freeze` side-state + own `last_live_state`. Orchestrator broadcast reaches both. |
| `waiting_for_project` (NEW) | **session-chat (initial state)** | Pre-`project_ready` state. session-chat is spawned in this state and awaits the orchestrator's `project_ready` event. |
| `exit_to_J003`, `exit_to_projects_page` | **session-chat (navigation events)** | NOT XState states; emitted as navigation side-effects. |

**`waiting_for_project` is a new state** (not in the original journey YAML's 12-state enumeration). It is purely an internal artifact of the split: session-chat exists as an actor before project-context settles `project_selected`; some state must precede `loading_session_list` so the actor has somewhere to "be" while waiting. The state has no user-visible surface — when session-chat is in `waiting_for_project`, the FE renders nothing from session-chat's projection (it consumes project-context's projection only). Adding `waiting_for_project` does NOT contradict the journey YAML's IMMUTABLE narrative (the YAML's 12 named states all remain; `waiting_for_project` is the XState-implementation-level analog of "session-chat is not yet meaningful"). **No FE component, no acceptance test, no projection consumer reads `state === "waiting_for_project"` as a UX trigger.**

### 2.1 Machine contexts (TypeScript types) — per machine (post-DWD-13)

#### 2.1.A `project-context` — TypeScript shape

```ts
// ui-state/lib/machines/project-context.ts (NEW FILE — DELIVER MR-1.5 refactor)

import { assign, fromPromise, setup } from "xstate";
import type { ActiveScope, ResourceType } from "../active-scope.ts";

export type ProjectContextState =
  | "resolving_initial_scope"
  | "no_projects_empty_state"
  | "creating_project"
  | "project_selected"
  | "switching_project"
  | "scope_mismatch_terminal"
  | "error_recoverable"
  | "freeze";

export interface ProjectContextMachineContext {
  correlation_id: string;
  principal_id: string;

  // From J-001 projection — set on `j001_ready` event entry:
  org_id: string;
  user_first_name: string | null;

  // The authoritative project context — populated on `project_selected` entry:
  project: { id: string | null; name: string | null };

  // Intent payloads for deep-link / switch — populated on transitions; cleared on settle:
  intent_project_id: string | null;

  // Cross-state plumbing:
  underlying_cause_tag: ProjectContextCauseTag | null;
  last_live_state: ProjectContextState | null;   // for freeze → history target on THAW
  retries: number;
  pending_project_name: string;                  // composer state preserved across creating_project retries
  project_validation_error: ProjectValidationError | null;

  // Last-used resolution (OQ-J002-5; populated on resolving_initial_scope exit):
  most_recent_session_per_project: Record<string /* project_id */, string /* iso ts */>;
  last_used_degraded_project_ids: string[];

  // Observability counters:
  scope_reconciled_count: number;
  stale_intents_dropped_count: number;
}

export type ProjectContextCauseTag =
  | "no_projects"
  | "transient"
  | "project_not_found"
  | "cross_tenant"
  | "access_revoked"
  | "replay_abandoned";

export type ProjectContextEvent =
  // External:
  | { type: "j001_ready"; org_id: string; user_first_name: string }   // orchestrator-broadcast on J-001 ready
  | { type: "create_project_clicked" }
  | { type: "create_project_submitted"; org_name: string }
  | { type: "switching_project_intent"; new_project_id: string }
  | { type: "back_to_projects_clicked" }
  | { type: "retry_clicked" }
  | { type: "open_deep_link"; intent_project_id?: string; intent_session_id?: string; intent_resource_id?: string; intent_resource_type?: ResourceType }
  // Cross-machine (orchestrator-emitted; never FE-emitted):
  | { type: "FREEZE"; origin_correlation_id: string }
  | { type: "THAW" };
```

Note that `intent_session_id` / `intent_resource_id` arrive via `open_deep_link` but project-context **does not** carry them in its own context — it forwards the deep-link payload to session-chat via an orchestrator hook on `project_selected` (see §3.2). project-context owns project-related intents only.

#### 2.1.B `session-chat` — TypeScript shape

```ts
// ui-state/lib/machines/session-chat.ts (NEW FILE — DELIVER MR-1.5 stub; MR-2+ extensions)

import { assign, fromPromise, setup } from "xstate";
import type { ActiveScope, ResourceType } from "../active-scope.ts";

export type SessionChatState =
  | "waiting_for_project"                // NEW (initial; pre-project_ready)
  | "loading_session_list"
  | "session_list_visible"
  | "resuming_session"
  | "session_active_no_messages"
  | "session_active"
  | "switching_dataset_context"
  | "error_recoverable"
  | "freeze";

export interface SessionSummary {
  id: string;
  title: string | null;
  last_active_at: string;
  active_dataset_id: string | null;
}

export interface TranscriptMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  ts: string;
}

export interface SessionChatMachineContext {
  correlation_id: string;
  principal_id: string;

  // Received via `project_ready` orchestrator broadcast — populated on entry to `loading_session_list`:
  org_id: string;
  project_id: string | null;       // null in `waiting_for_project`; non-null thereafter
  project_name: string | null;     // for display; FE may also read from project-context projection

  // Session list state — populated on session_list_visible entry:
  session_list: SessionSummary[];
  session_list_next_cursor: string | null;

  // Active session — populated on session_active entry:
  session_id: string | null;
  transcript: TranscriptMessage[];

  // Active resource (dataset) — populated on session_active entry + switching_dataset_context exit:
  resource: { type: ResourceType | null; id: string | null };

  // Intent payloads — populated on transitions; cleared on settle:
  intent_session_id: string | null;
  intent_resource_id: string | null;
  intent_resource_type: ResourceType | null;

  // Cross-state plumbing:
  underlying_cause_tag: SessionChatCauseTag | null;
  last_live_state: SessionChatState | null;
  retries: number;
  pending_first_message: string;        // composer text preserved across session_active_no_messages → error_recoverable

  // Observability counters:
  stale_intents_dropped_count: number;
}

export type SessionChatCauseTag =
  | "transient"
  | "list_sessions_degraded"
  | "session_not_found"
  | "dataset_not_found"
  | "dataset_access_denied"
  | "replay_abandoned";

export type SessionChatEvent =
  // External:
  | { type: "session_clicked"; session_id: string }
  | { type: "new_session_clicked" }
  | { type: "first_message_sent"; content: string }
  | { type: "dataset_resolved_by_agent"; resource_id: string; resource_type: ResourceType }
  | { type: "dataset_picked_directly"; resource_id: string; resource_type: ResourceType }
  | { type: "retry_clicked" }
  | { type: "suggestion_chip_clicked_upload" }
  | { type: "suggestion_chip_clicked_browse_projects" }
  // Cross-machine (orchestrator-emitted; never FE-emitted):
  | { type: "project_ready"; org_id: string; project_id: string; project_name: string; correlation_id: string; intent_session_id?: string; intent_resource_id?: string; intent_resource_type?: ResourceType }
  | { type: "FREEZE"; origin_correlation_id: string }
  | { type: "THAW" };
```

The `project_ready` event payload carries any pending deep-link `intent_session_id`/`intent_resource_*` that project-context forwarded (see §3.2). session-chat consumes them when transitioning out of `waiting_for_project` (e.g., deep-link to `/chat/:channelId` lands directly in `resuming_session`).

#### 2.1.C What was carved up

The pre-amendment `J002MachineContext` (originally 18 fields) split cleanly along the project-vs-session axis:

| Original field | Owning machine | Notes |
|---|---|---|
| `correlation_id`, `principal_id` | **both** | Each carries its own; orchestrator threads through. |
| `org_id`, `user_first_name` | **project-context** (authoritative) + **session-chat** (received via `project_ready`) | Same value; session-chat reads from its own context to avoid cross-machine reads. |
| `project: {id, name}` | **project-context** (authoritative) + **session-chat** (received `project_id`+`project_name` from `project_ready`) | Same source of truth; the duplication is a fair price for ADR-028 independence. |
| `session_list`, `session_list_next_cursor`, `session_id`, `transcript`, `resource` | **session-chat** | Entirely session-domain. project-context never reads these. |
| `most_recent_session_per_project`, `last_used_degraded_project_ids` | **project-context** | Populated during `resolving_initial_scope` exit; needed for last-used resolution. session-chat receives the resolved `project_id` already. |
| `intent_project_id` | **project-context** | project-context handles project-level deep-link intents. |
| `intent_session_id`, `intent_resource_id`, `intent_resource_type` | **session-chat** (received via `project_ready` payload extension) | Forwarded from `open_deep_link` event by project-context's `project_selected` entry hook into the orchestrator's `project_ready` payload. |
| `underlying_cause_tag`, `last_live_state`, `retries` | **both (each has its own)** | Per-machine retry/cause vocabulary. session-chat's cause tag union is disjoint from project-context's (no overlap; closed at the type level). |
| `pending_project_name` | **project-context** | Composer-state preservation for project creation retry. |
| `pending_first_message` | **session-chat** | Composer-state preservation for new-session-eager-create retry. |
| `project_validation_error` | **project-context** | Inline form error scoped to project creation. |
| `scope_reconciled_count` | **project-context** | (Stale-link reconciliation lives in project-context's call sites.) |
| `stale_intents_dropped_count` | **both (each tracks its own)** | DWD-7 stale-intent guards are per-machine; counts are per-machine. |

**The `ProjectFlow*` type names in `ui-state/lib/machines/project-and-chat-session-management.ts` today (post-MR1-leak-cleanup `af434b2`) become the basis for both new types**: most fields move 1:1; `J002State` → `ProjectContextState` ∪ `SessionChatState`; etc. The MR-1.5 refactor preserves the type-name discipline (no `J002*` leakage) per the post-MR-1 cleanup decision.

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

Each cause-tag union (`ProjectContextCauseTag`, `SessionChatCauseTag`) is closed (per ADR-029 §"named diagnostic" discipline) so the FE renders deterministic copy variants from the relevant projection's `state.context.underlying_cause_tag`. The two unions are disjoint by construction (no overlap), so a unified UI predicate `(projectContext.context.underlying_cause_tag ?? sessionChat.context.underlying_cause_tag)` is unambiguous.

### 2.2 Top-level FREEZE handler — per machine (per US-210 / Slice 6; DWD-6 + DWD-13)

Both machines declare an identical top-level `on.FREEZE` handler. XState v5's top-level `on` is inherited by every state, satisfying US-210 AC "reachable from every non-terminal state" inside each machine.

```ts
// project-context.ts
.createMachine({
  id: "project-context",
  initial: "resolving_initial_scope",
  on: {
    FREEZE: {
      target: ".freeze",
      actions: assign({ last_live_state: ({ value }) => value as ProjectContextState }),
    },
  },
  states: { /* 8 states — see §2.3.A */ },
})
```

```ts
// session-chat.ts
.createMachine({
  id: "session-chat",
  initial: "waiting_for_project",
  on: {
    FREEZE: {
      target: ".freeze",
      actions: assign({ last_live_state: ({ value }) => value as SessionChatState }),
    },
  },
  states: { /* 9 states — see §2.3.B */ },
})
```

Each `freeze` state declares `on.THAW` with a target derived from its own `last_live_state` (one-arm conditional transition). The orchestrator's broadcast loop (`orchestrator.ts:796-820`) enumerates spawned actors AND already sends `FREEZE` to each one regardless of machine type — no orchestrator change is required to support broadcasting to two J-002 actors per principal. The broadcast also exempts the origin flow (the actor that triggered the freeze, typically J-001).

### 2.3 State-by-state mapping

Per DWD-13 the mapping splits into **two tables** below — one per machine. Each row maps a journey YAML state to its concrete XState transition set inside the owning machine. **`on` events derive from the journey YAML's `transitions` block (IMMUTABLE) plus the top-level `FREEZE` handler. `invoke` actors are declared at the `setup({actors: {...}})` level (factory wiring in §3).**

#### 2.3.A `project-context` — 8 states

| Journey state | XState `on` events → target | `invoke` actor | `actions` (entry / exit / transition) | Story coverage |
|---|---|---|---|---|
| `resolving_initial_scope` (initial) | `j001_ready` → self (entry from J-001); `resolved_with_project` → `project_selected`; `resolved_no_projects` → `no_projects_empty_state`; `scope_mismatch` → `scope_mismatch_terminal`; `open_deep_link` → self (re-resolve) | `resolveInitialScope` (input: `{org_id, intent_project_id?, principal_id}`; output: `{project: ProjectSummary, most_recent_session_per_project?, degraded_project_ids?} \| {no_projects: true} \| {cross_tenant: true} \| {project_not_found: true}`). Reads `list_projects(user)` + `most_recent_session_per_project` lazily per OQ-J002-5 / DWD-9. **Deep-link intent_session_id / intent_resource_id are captured by project-context here, then forwarded to session-chat in the `project_ready` payload on `project_selected` entry (see §3.2).** | Emit `j002_resolution_started`; on settle emit `project_selected` / `no_projects_displayed` / `scope_mismatch_displayed` and assign `context.project` / `context.org_id` / `context.most_recent_session_per_project`. | US-201, US-202, US-204 |
| `no_projects_empty_state` | `create_project_clicked` → `creating_project`; `create_project_submitted` → `creating_project` (with composer payload) | (none — interactive) | Entry assigns `context.underlying_cause_tag = "no_projects"`; emit `no_projects_displayed`. **session-chat is NOT spawned on this branch** (orchestrator only broadcasts `project_ready` on `project_selected` entry). | US-201 |
| `creating_project` | invoke `onDone` → `project_selected`; invoke `onError` (`validation_failed`) → `no_projects_empty_state`; invoke `onError` (transient) → `error_recoverable` | `createProject` (input: `{org_name, correlation_id, principal_id}`; output: `ProjectSummary`). Wraps `POST /api/projects` via `uiStateClient`. | Emit `project_creation_started`; on success emit `project_created` and assign `context.project`; on validation fail set `context.project_validation_error` (mirrors J-001 `recordOrgValidationError` action at `login-and-org-setup.ts:163-183`). | US-201 |
| `project_selected` | `switching_project_intent` → `switching_project` | (none — fires side-effect on entry) | Entry assigns `context.project`, emits `project_selected` event with payload `{project_id, project_name, correlation_id, forwarded_intent_session_id?, forwarded_intent_resource_id?, forwarded_intent_resource_type?}`. **The orchestrator's `priorState` watcher sees this entry and broadcasts `project_ready` to session-chat** (spawning if not started). project-context does NOT spawn session-chat itself (ADR-028:46-48). | US-202, US-204, US-207 |
| `switching_project` | invoke `onDone` → `project_selected`; invoke `onDone` (`cross_tenant` / `access_revoked`) → `scope_mismatch_terminal`; invoke `onError` (transient) → `error_recoverable` | `switchProject` (input: `{new_project_id, principal_id}`; output: `{project: ProjectSummary} \| {cross_tenant: true} \| {access_revoked: true}`). Calls ScopeResolver invariant 4 first; on pass calls `get_project(new_project_id)`. | Entry assigns `context.intent_project_id = event.new_project_id`, emits `switching_project_started { old_project_id, new_project_id, correlation_id }`. **The FE's SSE cancellation is triggered by project-context's projection `state` transitioning to `switching_project`** — the chat-view component's `useEffect` cleanup (which is watching project-context's state) calls `eventSource.close()` (US-207 AC). On `onDone` settle into `project_selected` — orchestrator re-broadcasts `project_ready` with the new `project_id` → session-chat invalidates `session_id`+`resource_*` atomically (see §3.2). | US-207 |
| `scope_mismatch_terminal` | `back_to_projects_clicked` → `resolving_initial_scope` (with intent cleared) | (none — terminal-recoverable) | Entry emits `scope_mismatch_displayed { intent_project_id, underlying_cause_tag, correlation_id }`. | US-204 |
| `error_recoverable` | `retry_clicked` → originating-state via `last_live_state` history-target | (none — recoverable) | Entry emits `project_context_recoverable_error { underlying_cause_tag, correlation_id, originating_state }`; preserves originating user-action payload in `context.pending_project_name` for US-201 retry. | US-201, US-202, US-204, US-207 |
| `freeze` (side-state, reachable via top-level `on.FREEZE`) | `THAW` → `last_live_state` (history target lookup); `replay_abandoned` → `error_recoverable` (cause `replay_abandoned`) | (none — side-state) | Entry emits `project_context_frozen { last_live_state, correlation_id }`. No outgoing mutations while in freeze. | US-210 |

#### 2.3.B `session-chat` — 9 states

| Journey state | XState `on` events → target | `invoke` actor | `actions` (entry / exit / transition) | Story coverage |
|---|---|---|---|---|
| `waiting_for_project` (initial) | `project_ready` → `loading_session_list` (always); `project_ready` with `intent_session_id` → `resuming_session` (deep-link to /chat/:channelId direct path); `FREEZE` → `freeze` | (none — interactive wait) | Entry emits `session_chat_waiting_for_project` (low-importance observability event; the FE never reads this state). On `project_ready`: assign `context.org_id` / `project_id` / `project_name` / `intent_session_id?` / `intent_resource_*?` from the event payload. | Internal — no story directly tests `waiting_for_project`. The state is exercised implicitly in US-201 (no_projects path: session-chat stays here forever or is never spawned), US-202, US-204, US-205. |
| `loading_session_list` | invoke `onDone` → `session_list_visible`; invoke `onDone` with `context.intent_session_id !== null` → `resuming_session` (deep-link continuation); invoke `onError` (transient) → `error_recoverable` (cause `list_sessions_degraded`); `project_ready` (re-broadcast on project switch) → self with re-invoke | `loadSessionList` (input: `{project_id, principal_id}`; output: `{items: SessionSummary[], next_cursor: string \| null, has_more: boolean}`). Wraps `list_sessions(project_id, user, page_size=30)`. | Entry emits `session_list_load_started`; on success assigns `context.session_list` + `context.session_list_next_cursor`, emits `session_list_loaded`. | US-203, US-207 (re-load on project switch) |
| `session_list_visible` | `session_clicked` → `resuming_session`; `new_session_clicked` → `session_active_no_messages`; `project_ready` (different `project_id`) → `loading_session_list` (invalidates session_id+resource); `suggestion_chip_clicked_upload` → `exit_to_J003`; `suggestion_chip_clicked_browse_projects` → `exit_to_projects_page` | (none — interactive) | Entry emits `session_list_displayed { project_id, session_count }`. The `no_sessions_empty_state` is **not a separate XState state** — it is a derived UI shape when `context.session_list.length === 0` (DWD-1). On `project_ready` with a different `project_id`, assign `session_id = null`, `resource = {type: null, id: null}`, then re-enter `loading_session_list` with the new project_id. | US-203 |
| `resuming_session` | invoke `onDone` → `session_active`; invoke `onDone` (`session_not_found`) → `session_list_visible`; invoke `onError` (transient) → `error_recoverable` | `resumeSession` (input: `{session_id, principal_id}`; output: `{session_id, transcript, active_dataset_id: string \| null} \| {session_not_found: true}`). Loads transcript via `list_session_events` AND reads `session.active_dataset_id` from `get_session(session_id)` per DWD-2. | Entry emits `session_resume_started { session_id, correlation_id }`; on success assigns `context.session_id`, `context.transcript`, and (if `active_dataset_id` resolves) `context.resource.{type: "dataset", id: active_dataset_id}`; emits `session_resumed`. If `active_dataset_id` is set but get_dataset 404s, assigns `context.resource = {type: null, id: null}` and emits `session_dataset_unavailable`. | US-205 |
| `session_active_no_messages` | `first_message_sent` → `session_active` (via `createSessionEagerly` invoke); `session_clicked` → `resuming_session`; `new_session_clicked` → self (no-op); `project_ready` (different `project_id`) → `loading_session_list` | `createSessionEagerly` (input: `{project_id, principal_id, first_message: string}`; output: `SessionSummary`). Fires `POST /api/projects/:id/sessions` AND fire-and-forget `update_session(id, {title: first_message[:80]})`. | Entry emits `session_welcome_displayed`. On `first_message_sent` invoke fires; on success assigns `context.session_id`, emits `session_active_reached`. Composer text preserved by FE component-local state across `error_recoverable` retry (see §6.4). | US-206 |
| `session_active` | `session_clicked` → `resuming_session`; `new_session_clicked` → `session_active_no_messages`; `project_ready` (different `project_id`) → `loading_session_list` (invalidates session_id+resource); `dataset_resolved_by_agent` → `switching_dataset_context`; `dataset_picked_directly` → `switching_dataset_context` | (none — interactive; chat turns dispatch from FE) | Entry emits `session_active_reached { project_id, session_id, resource_type, resource_id, correlation_id }`. This is session-chat's "ready" — the analog of J-001 `ready`. | US-205, US-206, US-209 |
| `switching_dataset_context` | invoke `onDone` (`dataset_attached`) → `session_active`; invoke `onDone` (`dataset_access_denied`) → `session_active`; invoke `onError` (transient) → `error_recoverable` | `switchDatasetContext` (input: `{session_id, intended_resource_type, intended_resource_id, principal_id, prior_resource: {type, id}, project_id}`; output: `{resource_type, resource_id, persisted: true} \| {dataset_access_denied: true, prior_resource: {type, id}}`). Calls ScopeResolver invariant 4 first; on pass calls `update_session(session_id, {active_dataset_id: <id>})` per DWD-2 + DWD-5. | Entry emits `switching_dataset_context_started`. On success assigns `context.resource` to new values, emits `dataset_attached`. On 403 leaves `context.resource` UNCHANGED, assigns `context.underlying_cause_tag = "dataset_access_denied"`, emits `dataset_access_denied`. | US-209 |
| `error_recoverable` | `retry_clicked` → originating-state via `last_live_state` history-target | (none — recoverable) | Entry emits `session_chat_recoverable_error { underlying_cause_tag, correlation_id, originating_state }`; preserves originating user-action payload (e.g., `pending_first_message` for US-206 retry). | US-203, US-205, US-206, US-209 |
| `freeze` (side-state, reachable via top-level `on.FREEZE`) | `THAW` → `last_live_state`; `replay_abandoned` → `error_recoverable` (cause `replay_abandoned`) | (none — side-state) | Entry emits `session_chat_frozen { last_live_state, correlation_id }`. No outgoing mutations. The FE renders the "Refreshing your session..." banner overlay on top of the prior state's last paint (US-210 Example 5). | US-210 |

**Exit transitions** (`exit_to_J003`, `exit_to_projects_page`) are not internal XState states — they are *navigation side-effects* emitted as events whose handlers fire `history.push` in the FE. They live in session-chat because the originating states (`session_list_visible`, `session_active`) live there.

**Cross-machine event arrows** in the per-machine tables above (`project_ready`, `FREEZE`, `THAW`, `replay_abandoned`) are **orchestrator-broadcast events** — never emitted by the receiving machine, never emitted by a peer machine. They flow via the orchestrator's `priorState` watcher hooks and `broadcastFreeze/broadcastThaw` per ADR-028 + DWD-6 + DWD-13 §Coordination contract.

### 2.4 Total state counts

| Machine | State count | Composition |
|---|---|---|
| `project-context` | **8** | 6 journey YAML states + `error_recoverable` + `freeze` |
| `session-chat` | **9** | 6 journey YAML states + `waiting_for_project` (initial, NEW per DWD-13) + `error_recoverable` + `freeze` |
| **Total unique states across both machines** | **17** (sum of 8+9) | But the journey YAML's IMMUTABLE 12-state contract is preserved: the 12 named states partition into 6 in project-context + 6 in session-chat; the journey YAML's `no_sessions_empty_state` collapses into `session_list_visible` per DWD-1; `error_recoverable` + `freeze` are duplicated (one per machine) per DWD-13; `waiting_for_project` is the internal pre-spawn state for session-chat. The two `exit_to_*` entries are navigation events, not states. |

The per-machine counts mirror J-001's 8-state shape (login-and-org-setup has 8 states), keeping each chart at the cohesion sweet spot the SRP review identified.

---

## 3. Cross-machine composition — J-001, project-context, session-chat (post-DWD-13)

> **Source contracts**: ADR-028 §"Decision outcome" + `ui-state/lib/orchestrator.ts` (FREEZE/THAW broadcast at lines 327-411; `priorState` watcher at lines 91-94/555-563; `beginIfNotStarted` at lines 286-411).

J-002 is now TWO sibling machines coordinating via the orchestrator (per DWD-13). The composition diagram is **one-way** at each hop: J-001 → orchestrator → project-context → orchestrator → session-chat. No machine imports any other; broadcasts are typed events.

### 3.1 The orchestrator extension (DWD-8 — three registry entries)

The MachineRegistry strategy table (DWD-8) now carries **three entries**.

```ts
// ui-state/lib/orchestrator.ts — DELIVER MR-1.5 (post-DWD-13)

import { createLoginAndOrgSetupMachine, type LoginMachineDeps } from "./machines/login-and-org-setup.ts";
import { createProjectContextMachine, type ProjectContextMachineDeps } from "./machines/project-context.ts";
import { createSessionChatMachine, type SessionChatMachineDeps } from "./machines/session-chat.ts";

type MachineFactory = (deps: OrchestratorDeps, input: { correlation_id: string; principal_id: string }) => AnyStateMachine;

interface MachineRegistry {
  "login-and-org-setup": MachineFactory;
  "project-context": MachineFactory;
  "session-chat": MachineFactory;
  // (Future: "dataset-upload", "transform", etc. — one line each.)
}

export class FlowOrchestrator {
  private readonly registry: MachineRegistry = {
    "login-and-org-setup": (deps, input) =>
      createLoginAndOrgSetupMachine(deps.loginMachineDeps),
    "project-context": (deps, input) =>
      createProjectContextMachine(deps.projectContextMachineDeps),
    "session-chat": (deps, input) =>
      createSessionChatMachine(deps.sessionChatMachineDeps),
  };

  // begin() and beginIfNotStarted() look up the factory; otherwise unchanged
  // from today's implementation (see orchestrator.ts:140-411).
  //
  // Direct /begin HTTP posts continue to be gated to "login-and-org-setup" only
  // (orchestrator.ts:158-164); the two J-002 machines are spawned exclusively
  // via beginIfNotStarted called from broadcast hooks.
}
```

**Effect**: J-003+ machines plug in via one new factory + one registry line. No `if/else` cascade.

**Reversibility**: if either J-002 machine misbehaves at MR-time, deleting its factory entry + the machine file disables it without orchestrator surgery. The other machine remains operable on its own (though if project-context is disabled, session-chat never receives `project_ready` and stays in `waiting_for_project` indefinitely — graceful degradation: user sees no project context).

### 3.2 The orchestrator's TWO broadcast hooks (DWD-6 + DWD-13)

The orchestrator's `priorState` map (`orchestrator.ts:91-94, 555-563`) carries the existing watcher that already drives FREEZE/THAW. The amendment adds a **second broadcast hook** alongside the existing `j001_ready` hook. Both hooks follow the same pattern.

#### 3.2.A Existing: `j001_ready` (spawn project-context)

When J-001 settles in `ready` (transition from `creating_org` or `authenticating`), the orchestrator calls:

```ts
this.beginIfNotStarted({
  machine: "project-context",                              // CHANGED from "project-and-chat-session-management" per DWD-13
  principal_id: <same>,
  correlation_id: <inherited from J-001's settling event>,
  org_id: <from J-001 context>,
  user_first_name: <from J-001 context>,
});
```

This spawns project-context (if not already running) AND sends it `{ type: "j001_ready", org_id, user_first_name }`. project-context's `resolving_initial_scope` invoke fires with `org_id` populated; no race window.

**No `j001_ready` is sent to session-chat.** session-chat does NOT need `org_id` until project-context settles `project_selected` — at which point session-chat receives `project_ready` carrying `org_id` plus the resolved `project_id`/`project_name`.

#### 3.2.B NEW: `project_ready` (spawn session-chat, or update existing session-chat on project switch)

When **project-context** transitions INTO `project_selected` (entry from `resolving_initial_scope`, `creating_project`, OR `switching_project`), the orchestrator calls:

```ts
this.beginIfNotStarted({
  machine: "session-chat",
  principal_id: <same>,
  correlation_id: <inherited from project-context's settling event>,
  // Payload forwarded into the project_ready event:
  org_id: <from project-context.context.org_id>,
  project_id: <from project-context.context.project.id>,
  project_name: <from project-context.context.project.name>,
  // Deep-link forwarding (project-context captured these on `open_deep_link`):
  intent_session_id: <from project-context.context.intent_session_id, if any>,
  intent_resource_id: <from project-context.context.intent_resource_id, if any>,
  intent_resource_type: <from project-context.context.intent_resource_type, if any>,
});
```

If session-chat is NOT yet spawned → spawn in `waiting_for_project` initial state → send `project_ready` immediately → transition `waiting_for_project → loading_session_list` (or directly to `resuming_session` if `intent_session_id` is present).

If session-chat IS already spawned AND its current `context.project_id` matches the broadcast `project_id` → **idempotent no-op**: the existing actor ignores the re-emission (session-chat's `project_ready` handler is guarded — see §2.3.B).

If session-chat IS already spawned AND its `context.project_id` does NOT match the broadcast `project_id` (project-switch path) → session-chat receives `project_ready` with the new `project_id` → transitions to `loading_session_list` after invalidating `session_id`+`resource_*` (the assign action in §2.3.B's `session_list_visible` / `session_active` rows). **This is the atomicity guarantee for US-207** — the old project's session/resource are NEVER visible against the new project_id.

**Implementation lineage** (per Praxis F-1 clarification, repeated from DWD-6 for `j001_ready` and extended to `project_ready`): the `project_ready` hook does NOT exist in live code today. It lands at MR-1.5 alongside the registry refactor (or MR-2, per the split-sequencing decision in DWD-13).

#### 3.2.C FREEZE / THAW / replay_abandoned — broadcast to BOTH machines

`ui-state/lib/orchestrator.ts:796-820` already implements:
- `broadcastFreeze(originFlowId)` — enumerates all spawned actors via `this.actors.entries()`, marks them in the `frozen` Map, sends `{ type: "FREEZE" }` to each child actor EXCEPT the origin.
- `broadcastThaw(originFlowId)` — enumerates the `frozen` Map, replays queued events in arrival order with original correlation_id, clears state.
- Buffer bounded: `REPLAY_BUFFER_CAP = 16`, `FREEZE_WINDOW_MS = 5000`. **Per-flow** — the buffer key is `flow_id`, so project-context and session-chat have INDEPENDENT replay buffers.

Both J-002 machines declare their own top-level `on.FREEZE` (§2.2) and their own `freeze` side-state's `on.THAW` (§2.3). **The orchestrator code is byte-unchanged.** Enumeration is machine-agnostic — when both J-002 actors are spawned and registered in `this.actors`, the existing broadcast loop reaches both naturally.

The trigger for FREEZE remains J-001 → `expired_token` (detected by the `priorState` map per `orchestrator.ts:555-563`). Neither J-002 machine ever EMITS FREEZE; both handle it. This is the architectural payoff ADR-028 §94 named — and Slice 6 is the first slice that observes it in production with TWO J-002 actors.

#### 3.2.D Lifecycle summary

| Phase | J-001 state | project-context state | session-chat state | Notes |
|---|---|---|---|---|
| Pre-auth | (any pre-ready) | (not spawned) | (not spawned) | The actor tree carries only J-001. |
| Post-J-001 settle | `ready` | `resolving_initial_scope` (spawned) | (not spawned) | `j001_ready` hook fires. session-chat is NOT spawned until `project_ready`. |
| Returning user, sessions exist | `ready` | `project_selected` | `session_list_visible` | `project_ready` hook fired on `project_selected` entry. |
| First-time user, no projects | `ready` | `no_projects_empty_state` | (not spawned) | `project_ready` NEVER fires; session-chat NEVER spawns. The FE projection from session-chat would return 404 — the FE only fetches session-chat's projection when project-context is in a state where it matters (`project_selected` and downstream). |
| Cross-tenant deep-link | `ready` | `scope_mismatch_terminal` | (not spawned) | Same; session-chat is never spawned. |
| Mid-flow project switch | `ready` | `switching_project → project_selected` | (state preserved, then) `loading_session_list` | `project_ready` re-fires with new `project_id`; session-chat invalidates and reloads. |
| Token expiry | `expired_token → ready` (silent reauth) | `freeze → resuming_session` (or whatever) | `freeze → session_active` (or whatever) | Both J-002 machines participate in FREEZE/THAW per §3.2.C. |

### 3.3 ADR-028:46-48 enforcement (no machine-to-machine imports)

`project-context.ts` MUST NOT import from `session-chat.ts`, and vice versa. Neither imports `login-and-org-setup.ts`. The orchestrator is the only mediator. Enforcement: the existing `dependency-cruiser` rule from ADR-027 §7 already covers this (`machines/` may not import sibling `machines/*.ts`); DESIGN adds no new rule. **The rule's coverage of the new file pair is automatic** — the rule matches any sibling pair under `machines/`.

Each J-002 machine reads its inputs from its OWN context (set on the relevant orchestrator-broadcast event). project-context reads `org_id` from the `j001_ready` event payload; session-chat reads `org_id`/`project_id`/`project_name` from the `project_ready` event payload. Neither calls into a sibling's projection from inside the machine. The composition is strictly one-way through the orchestrator.

### 3.4 The deep-link forwarding contract (DWD-13)

A cold-deep-link URL like `/chat/:channelId` carries `intent_session_id`. The FE's loader fires `open_deep_link` to project-context (project-context is the entry point — it owns `intent_project_id`, and the deep-link arrives BEFORE any project is settled). project-context captures the deep-link payload on `open_deep_link` (its existing `on.open_deep_link` handler — see `project-and-chat-session-management.ts:240-260` post-MR-1) and forwards the **session-level intents** to session-chat via the `project_ready` payload at the moment project-context enters `project_selected`.

The forwarding is the orchestrator's responsibility — it reads project-context's context on `project_selected` entry and packages the relevant intents into the `project_ready` payload:

```ts
// inside orchestrator's priorState watcher, on project-context entering project_selected
if (currentMachine === "project-context" && newState === "project_selected") {
  const ctx = actor.getSnapshot().context as ProjectContextMachineContext;
  await this.beginIfNotStarted({
    machine: "session-chat",
    principal_id,
    correlation_id: ctx.correlation_id,
    org_id: ctx.org_id,
    project_id: ctx.project.id!,
    project_name: ctx.project.name!,
    intent_session_id: ctx.intent_session_id,    // forward from project-context's intent fields
    intent_resource_id: ctx.intent_resource_id,
    intent_resource_type: ctx.intent_resource_type,
  });
  // Optionally clear the forwarded intents from project-context's context (or
  // leave them — they only matter at this transition):
  actor.send({ type: "__intents_forwarded__" });
}
```

**This means project-context's `ProjectContextMachineContext` carries `intent_session_id`/`intent_resource_*` fields TRANSIENTLY** — between `open_deep_link` and `project_selected` only. The fields are present in §2.1.A's context type AND nulled by an internal `__intents_forwarded__` event after the orchestrator hook fires. (Alternative: project-context never carries `intent_session_id` and the orchestrator instead reads the FE's loader payload directly. The current design keeps the intents in project-context for testability — the harness can assert on `context.intent_session_id` mid-flow.)

The end-to-end flow: FE loader → `open_deep_link` to project-context → project-context captures intents → resolves project → `project_selected` entry → orchestrator hook forwards intents in `project_ready` → session-chat spawns and consumes the intents (transitioning to `resuming_session` if `intent_session_id` is non-null).

This preserves US-204 Example 5 (deep-link with intent_resource carries through to session_active) end-to-end without violating ADR-028 — the orchestrator is the carrier, not session-chat reading project-context's context directly.

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

#### 4.1.1 Deprecation window mechanics (per Praxis review F-2)

The flag + sunset combination needs explicit operational mechanics so the MR-4 DELIVER engineer can execute the cutover safely:

1. **Flag lifecycle.** `SCOPE_HEADER_FALLBACK_ENABLED` persists in the codebase **until an MR explicitly removes the flag and its body-fallback branch**. There is no auto-disable. The forcing function is the compile-time sunset check — once `Date.now() >= SCOPE_HEADER_FALLBACK_SUNSET.getTime()`, the agent refuses to start (per above) UNLESS `SCOPE_HEADER_FALLBACK_ENABLED` has been removed from the codebase entirely. The engineer landing MR-4 sets a calendar reminder for ~6 weeks post-merge to land the removal MR.

2. **Revert behavior.** The check condition is `if (Date.now() >= SCOPE_HEADER_FALLBACK_SUNSET.getTime() && process.env.SCOPE_HEADER_FALLBACK_ENABLED === "true") throw new Error(...)`. Once the removal MR lands and reverts ever happen post-sunset, the build fails at startup (the check still exists; the flag env-var resolves to undefined ≠ "true"; the check passes). If a panic-revert restores the flag after sunset, the agent again refuses to start — preventing accidental regression of the cross-tenant surface.

3. **Post-sunset 400 error body.** Once the flag is removed, clients that still send `project_id` in the body without the header receive:
   ```json
   {
     "error": "missing X-Active-Scope header",
     "hint": "Clients older than version X.Y.Z are not supported after 2026-MM-DD; please upgrade.",
     "docs": "https://docs.dashboard-chat.example/migrate/x-active-scope"
   }
   ```
   The agent emits a `scope_header_post_sunset_rejected { user_agent, ip }` log event for any such request (allows ops to identify and contact remaining legacy clients).

4. **Observability — when to remove the flag.** The `scope_header_fallback_used { calling_client }` event emitted by the fallback path is the signal: once that event rate trends to < 0.1% of chat turns for two consecutive release windows, the flag-removal MR is safe to land before sunset (early removal is acceptable; late removal is not).

The MR-4 engineer SHOULD: (a) set the literal sunset date in the constant, (b) add a calendar reminder for ~6 weeks post-merge, (c) draft the removal MR's body text in advance with the post-sunset 400 body shape above. The MR-removing-the-flag is one-file (just `agent/lib/chat/handleChat.ts`) and ~30 lines of net deletion.

### 4.3 The FE side: `uiStateClient` extension (post-DWD-13)

`frontend/app/lib/ui-state-client.ts` today exposes one method (`getProjection`). J-002 (post-amendment) extends it with **four new methods** (one read + one write per machine) plus a **composer** for the unified J-002 view and the X-Active-Scope writer:

```ts
// frontend/app/lib/ui-state-client.ts — extension (DWD-4 + DWD-13)

export function uiStateClient(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";

  return {
    async getProjection(machine: string, flowId?: string): Promise<FlowProjection> { /* unchanged */ },

    // NEW per machine (DWD-13) — used by loaders to read per-machine state.
    async getProjectContextProjection(principal_id: string, intent?: { project_id?: string; session_id?: string; resource_id?: string; resource_type?: ResourceType }): Promise<FlowProjection> {
      /* fetches GET /ui-state/flow/project-context/projection?flow_id=…; optionally posts open-deep-link first */
    },
    async getSessionChatProjection(principal_id: string): Promise<FlowProjection> {
      /* fetches GET /ui-state/flow/session-chat/projection?flow_id=… */
    },

    async postProjectContextEvent(principal_id: string, event: { type: string; payload: Record<string, unknown>; correlation_id: string }): Promise<FlowProjection> {
      /* POSTs /ui-state/flow/project-context/event */
    },
    async postSessionChatEvent(principal_id: string, event: { type: string; payload: Record<string, unknown>; correlation_id: string }): Promise<FlowProjection> {
      /* POSTs /ui-state/flow/session-chat/event */
    },

    // Composer: fetches BOTH projections (project-context always; session-chat conditionally — see below)
    // and returns the unified J-002 view loaders consume.
    async getJ002Projection(principal_id: string, intent?: J002Intent): Promise<J002UnifiedView> {
      const pc = await this.getProjectContextProjection(principal_id, intent);
      // session-chat is only fetched when project-context is past `project_selected` — saves an HTTP call
      // on the no-projects / scope-mismatch paths where session-chat is never spawned.
      const needsSessionChat = ["project_selected", "switching_project"].includes(pc.state)
        || ["session_list_visible", "loading_session_list", "resuming_session", "session_active_no_messages", "session_active", "switching_dataset_context", "error_recoverable", "freeze"].some(s => pc.state === s); // covers downstream
      const sc = needsSessionChat ? await this.getSessionChatProjection(principal_id) : null;
      return { projectContext: pc, sessionChat: sc };
    },

    // X-Active-Scope writer — composes from BOTH projections.
    //   Auth-proxy and backend already strip/inject this on the way out; the FE just sets it on outbound fetches.
    activeScopeHeader(view: J002UnifiedView): string {
      const pc = view.projectContext;
      const sc = view.sessionChat;
      const scope: ActiveScope = {
        org_id: (pc.context as ProjectContextMachineContext).org_id,
        project_id: (pc.context as ProjectContextMachineContext).project?.id ?? null,
        resource_type: (sc?.context as SessionChatMachineContext | undefined)?.resource?.type ?? null,
        resource_id: (sc?.context as SessionChatMachineContext | undefined)?.resource?.id ?? null,
      };
      return JSON.stringify(scope);
    },
  };
}

type J002UnifiedView = { projectContext: FlowProjection; sessionChat: FlowProjection | null };
type J002Intent = { project_id?: string; session_id?: string; resource_id?: string; resource_type?: ResourceType };
```

**Why two read methods + one composer**: the loader code (§6) reads BOTH per-machine projections most of the time (returning user; deep-link). The composer skips the session-chat fetch only on the early branches where session-chat is never spawned (no_projects / scope_mismatch_terminal). This keeps the loader code simple ("call `getJ002Projection`; consume `view.projectContext.state` and `view.sessionChat?.state`") while avoiding a wasteful HTTP call on the no-projects path.

The `activeScopeHeader(view)` helper is the **single writer** of `X-Active-Scope`. No FE component ever constructs the header inline. The Slice 4 ESLint rule (per ADR-029 §2 lint contract + US-208 AC + DWD-3) forbids manual `X-Active-Scope` header sets outside this helper. **The lint rule's import-path enforcement is byte-unchanged by DWD-13** — the rule targets the literal string `X-Active-Scope` as the header key and the literal call site of `activeScopeHeader`. Since the helper's signature change is internal (the rule cares about WHO writes, not WHAT they write), no rule update is needed.

**Composer purity**: `activeScopeHeader` is a pure function over the two projections — no I/O, no state. Property-based tests can assert that for any pair of valid projections, the composed scope is deterministic and satisfies ADR-029's invariants (org_id present iff project-context is past `resolving_initial_scope`; project_id present iff project-context is `project_selected` or downstream; resource_* present only when session-chat's `context.resource` is non-null).

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

This is the foundation every J-002 loader builds on. Sequential ordering: J-001 projection FIRST, then (in J-002-territory routes) BOTH J-002 projections (composed via `getJ002Projection` per §4.3).

**Per DWD-13**: the loader's `getJ002Projection` returns `{ projectContext: FlowProjection, sessionChat: FlowProjection | null }`. The loader emits this as `useLoaderData` payload; the route component consumes `view.projectContext.state` to decide what to render. The render decision tree:

- `view.projectContext.state === "resolving_initial_scope"` → render the loading skeleton.
- `view.projectContext.state === "no_projects_empty_state"` → render the welcome panel; `view.sessionChat` is null (never spawned).
- `view.projectContext.state === "scope_mismatch_terminal"` → render the named-diagnostic panel; `view.sessionChat` is null.
- `view.projectContext.state === "project_selected"` → render project chip + lean on `view.sessionChat.state` for the body (session list / resume / etc.).
- `view.projectContext.state === "switching_project"` → render the SSE cancellation logic and "switching" hint; `view.sessionChat` may briefly show the OLD project's state — but the chat-view's `useEffect` cleanup is already firing on this transition (per §6.3).

The two-projection composition makes the legacy "single J-002 state" mental model cleanly mappable: `unified.state ≡ (projectContext.state if project-context is not in {project_selected, switching_project}; else sessionChat.state)`.

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

### 6.3 The SSE cancellation contract (Slice 4 / US-207; post-DWD-13)

The SSE cancellation logic watches **project-context's** projection state, not session-chat's. When project-context's state transitions to `switching_project`, the chat-view component's `useEffect` cleanup calls `eventSource.close()`. This is correct because:
- project-context emits `switching_project` on `switching_project_intent` BEFORE the new project_id is resolved.
- session-chat's `session_active` state is still active at that instant (session-chat hasn't seen `project_ready` yet).
- The SSE close must happen BEFORE the new project's `project_ready` lands so the cancelled stream never delivers a frame against the new scope.

This matches the order of operations: project-context transitions FIRST → FE observes it → SSE closes → project-context settles `project_selected` (or scope_mismatch_terminal) → orchestrator broadcasts `project_ready` → session-chat invalidates and reloads.

#### 6.3.A The chat-view component's projection subscription



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

The endpoint shape (Slice 2 DELIVER): TWO Hono SSE handlers, one per machine, that subscribe to the Redis flow-event log keys (`ui-state:project-context:<principal_id>:events` AND `ui-state:session-chat:<principal_id>:events`) via Redis Streams `XREAD BLOCK`. On each new event, each handler rebuilds the respective projection (or sends an incremental delta — Slice 2 ships full projection per ADR-027 §4) and pushes it down its SSE channel. The FE subscribes via TWO `EventSource` instances from the chat-shell route's `useEffect`.

**Per DWD-13**: the cross-tab session-list refresh case (US-203 Example 4) is driven by **session-chat's** projection stream (where the new session lands in `context.session_list`). project-context's projection stream covers project-list refresh and project-switch cases. Each tab opens both SSE connections; each is independent.

**Cross-tab safety**: each tab opens its own pair of SSE connections; both receive the same broadcast events. Tab A's list refreshes when Tab B's `POST /sessions` lands a new session row + session-chat's `loading_session_list` re-fires (or the new session emits a `session_list_invalidated` FlowEvent — see DWD-9 for the chosen mechanism).

### 6.6 Library-mode interop (ADR-034 inheritance)

Routes NOT graduated to loaders (e.g., `/table/:datasetId`) continue to work as today. They are NOT J-002-territory; they receive `active_scope` from `useRouteLoaderData("root")` (J-001's `org_id`) but not from J-002's projection. If they need `project_id`, today they read from `useParams("projectId")` — which is on its way out per ADR-029 §2. Slice 4's lint rule (DWD-3) extends to forbid `useParams("projectId")` outside loader scope; library-mode routes that need it use a transitional `useJ002Scope()` hook that reads from a (post-Slice-2) React Context populated by the chat-shell loader. **This is the strangler-fig pattern from ADR-027 §"Migration of AuthContext.tsx consumers" applied to project_id.**

---

## 7. Projection shape extensions (DWD-9)

> **Source contract**: ADR-027 §4 (the `FlowProjection` envelope is the SSOT shape; FE + harness read identical JSON).

### 7.1 The `FlowProjection` envelope is unchanged (one per machine)

```ts
type FlowProjection = {
  flow_id: string;
  state: string;                    // The machine's state name (project-context: 8 states; session-chat: 9 states — §2.4)
  context: Record<string, unknown>; // The machine's context (project-context: §2.1.A; session-chat: §2.1.B)
  active_scope: ActiveScope;        // ADR-029 contract; each machine populates its half (see §7.4)
  sequence_id: number;
  last_event_at: string;
  correlation_id: string;
};
```

**Verbatim from `ui-state/lib/projection.ts:22-30`. No envelope change.** Per DWD-9 (reaffirmed by DWD-13): the envelope shape is the SSOT contract every consumer reads. The split changes WHICH flow_id corresponds to WHICH machine, not the envelope shape itself.

Per ADR-030 §6, `flow_id = {machine-name}:{principal_id}`. Post-DWD-13 we have THREE flow types per principal (when all are spawned):

| Machine | flow_id pattern | Per-principal cardinality |
|---|---|---|
| `login-and-org-setup` (J-001) | `login-and-org-setup:<principal_id>` | 1 |
| `project-context` (J-002 half 1) | `project-context:<principal_id>` | 1 |
| `session-chat` (J-002 half 2) | `session-chat:<principal_id>` | 0 or 1 (only when project-context is past `project_selected`) |

Redis cardinality is bounded by `principals × 3`; well within ADR-030 §3's planning-horizon budget.

### 7.2 What lives in `context.*` per machine (post-DWD-13)

#### 7.2.A `project-context` projection — context fields

| Field | Populated when | Consumed by |
|---|---|---|
| `context.project: {id, name}` | `project_selected` entry; `switching_project → project_selected` re-entry | FE app-shell project chip; FE project-detail page header; orchestrator's `project_ready` hook payload |
| `context.org_id` | `j001_ready` event entry | active_scope derivation; session-chat (via project_ready); X-Active-Scope.org_id |
| `context.user_first_name` | `j001_ready` event entry | FE greeting copy |
| `context.intent_project_id` / `intent_session_id` / `intent_resource_id` / `intent_resource_type` | `open_deep_link` event entry | Transient; forwarded to session-chat in the `project_ready` payload on `project_selected` entry; then nulled per §3.4 |
| `context.last_live_state` | `freeze` entry | TS harness; FE "Refreshing your session..." banner attribution |
| `context.most_recent_session_per_project` | `resolving_initial_scope` exit | Last-used resolution (US-202); FE Projects grid sort hint |
| `context.last_used_degraded_project_ids` | `resolving_initial_scope` exit (degraded sub-set) | DEVOPS instrumentation; emits `last_used_resolution_degraded` |
| `context.underlying_cause_tag` | `error_recoverable`, `scope_mismatch_terminal` entry | FE named-diagnostic panels (closed-vocabulary copy variants) |
| `context.pending_project_name`, `context.project_validation_error` | `creating_project` / `error_recoverable` | Composer state preservation for US-201 retry |
| `context.scope_reconciled_count`, `context.stale_intents_dropped_count` | Various transitions | DEVOPS instrumentation; TS harness assertions |

#### 7.2.B `session-chat` projection — context fields

| Field | Populated when | Consumed by |
|---|---|---|
| `context.org_id`, `context.project_id`, `context.project_name` | `project_ready` event entry (initial AND re-entry on project switch) | active_scope derivation; X-Active-Scope.{org_id, project_id} |
| `context.session_list: SessionSummary[]` | `session_list_visible` entry (first page) | FE recent-sessions nav (first 5); FE Chats page (first 30) |
| `context.session_list_next_cursor: string \| null` | same | FE Chats page pagination |
| `context.session_id: string \| null` | `session_active` entry | Agent's `thread_id` parameter; FE chat-view transcript binding |
| `context.transcript: TranscriptMessage[]` | `session_active` entry (from resume OR new-session-eager-create) | FE chat-view |
| `context.resource: {type, id}` | `session_active` entry; `switching_dataset_context` exit | FE chat-view gutter dataset chip; X-Active-Scope.resource_* |
| `context.intent_session_id` / `intent_resource_id` / `intent_resource_type` | `project_ready` event entry (forwarded from project-context per §3.4) | Drives the `resuming_session` direct path from `waiting_for_project`; consumed on settle |
| `context.last_live_state` | `freeze` entry | TS harness; FE "Refreshing your session..." banner attribution |
| `context.underlying_cause_tag` | `error_recoverable` entry | FE inline error UX |
| `context.pending_first_message` | `session_active_no_messages` / `error_recoverable` | Composer state preservation for US-206 retry |
| `context.stale_intents_dropped_count` | DWD-7 guarded transitions | DEVOPS instrumentation; TS harness assertions |

### 7.3 The dispatch-table extension in `projection.ts` (per-machine namespacing)

`ui-state/lib/projection.ts:107-242` declares `EVENT_HANDLERS` as a strategy table. Per DWD-13, the table is **namespaced by machine** to avoid event-name collisions and clarify which projection consumes which event. Each machine's handlers operate on the right context shape:

```ts
// ui-state/lib/projection.ts — post-DWD-13 (DELIVER MR-1.5+)

const PROJECT_CONTEXT_EVENT_HANDLERS: Record<string, EventHandler> = {
  j002_resolution_started: /* ... */,  // event name kept for back-compat / DEVOPS instrumentation
  project_selected: /* ... */,
  no_projects_displayed: /* ... */,
  project_creation_started: /* ... */,
  project_created: /* ... */,
  scope_mismatch_displayed: /* ... */,
  switching_project_started: /* ... */,
  project_switched: /* ... */,
  project_context_recoverable_error: /* ... */,
  project_context_frozen: /* ... */,
  project_context_thawed: /* ... */,
};

const SESSION_CHAT_EVENT_HANDLERS: Record<string, EventHandler> = {
  session_chat_waiting_for_project: /* ... */,
  session_list_load_started: /* ... */,
  session_list_loaded: /* ... */,
  session_list_displayed: /* ... */,
  session_resume_started: /* ... */,
  session_resumed: /* ... */,
  session_dataset_unavailable: /* ... */,
  session_welcome_displayed: /* ... */,
  session_active_reached: /* ... */,
  switching_dataset_context_started: /* ... */,
  dataset_attached: /* ... */,
  dataset_access_denied: /* ... */,
  session_chat_recoverable_error: /* ... */,
  session_chat_frozen: /* ... */,
  session_chat_thawed: /* ... */,
  stale_intent_dropped_after_thaw: /* ... */,
};

// The buildProjection function reads the flow_id to know which dispatch table to use.
function getDispatchTable(flow_id: string): Record<string, EventHandler> {
  if (flow_id.startsWith("login-and-org-setup:")) return EXISTING_J001_HANDLERS;
  if (flow_id.startsWith("project-context:")) return PROJECT_CONTEXT_EVENT_HANDLERS;
  if (flow_id.startsWith("session-chat:")) return SESSION_CHAT_EVENT_HANDLERS;
  return {};
}
```

Examples (DELIVER artifact):

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

### 7.4 The `active_scope` derivation — per-machine + composer (post-DWD-13)

`projection.ts:280-293` today derives `active_scope` from `context.resolved_scope` (set by `deep_link_opened`) OR from `context.org`. Per DWD-13, the derivation now lives at TWO layers:

#### 7.4.A Per-machine projection-level derivation

Each machine's projection carries its own `active_scope` derived from ONLY that machine's context. The derivation is the same pure function pattern as today.

**project-context projection's `active_scope`** carries `org_id` and `project_id` (no `resource_*` — project-context doesn't own resource state):

```ts
// projection.ts — project-context's active_scope (DWD-13)
let scope: ActiveScope = EMPTY_SCOPE;
if (context.project?.id) {
  scope = {
    org_id: context.org_id ?? "",
    project_id: context.project.id,
    resource_type: null,   // project-context never sets this; session-chat owns it
    resource_id: null,
  };
} else if (context.org_id) {
  // Pre-project_selected (resolving_initial_scope, no_projects_empty_state, etc.)
  scope = { org_id: context.org_id, project_id: null, resource_type: null, resource_id: null };
}
```

**session-chat projection's `active_scope`** carries `org_id` (inherited from `project_ready`), `project_id` (inherited from `project_ready`), and `resource_*` (the session-chat-owned half):

```ts
// projection.ts — session-chat's active_scope (DWD-13)
let scope: ActiveScope = EMPTY_SCOPE;
if (context.project_id) {
  scope = {
    org_id: context.org_id,
    project_id: context.project_id,
    resource_type: context.resource?.type ?? null,
    resource_id: context.resource?.id ?? null,
  };
}
// In `waiting_for_project`: scope = EMPTY_SCOPE.
```

**The two projection-level `active_scope` fields agree** on `org_id` and `project_id` whenever both machines have settled past their initial-resolution states. The agreement is a consequence of the `project_ready` broadcast contract — session-chat receives org_id+project_id from the SAME source project-context emits.

#### 7.4.B Composer-level derivation (the FE's authoritative view)

The FE's `uiStateClient.activeScopeHeader(view)` from §4.3 is the authoritative composer for outbound HTTP. It takes BOTH projections and produces ONE `ActiveScope` for the `X-Active-Scope` header. Semantically:

| Scope field | Source |
|---|---|
| `org_id` | `projectContext.context.org_id` (authoritative — project-context received it from J-001 first). |
| `project_id` | `projectContext.context.project.id` (authoritative — project-context owns project resolution). |
| `resource_type` | `sessionChat?.context.resource?.type ?? null` (session-chat owns; null if not spawned). |
| `resource_id` | `sessionChat?.context.resource?.id ?? null` (same). |

The composer NEVER reads `sessionChat.context.project_id` — that field exists only as session-chat's inherited copy for actor-locality. The authoritative source remains project-context. This avoids the (theoretical) case where session-chat's inherited copy lags project-context's; the composer always prefers the upstream source.

**Single source of truth invariant preserved** (DWD-9 reaffirmed): the FE/harness/agent all read the same derived `ActiveScope` from the composer. The composer is a pure function; the two underlying projections are independent FlowProjection envelopes; no parallel state.

**TS-harness assertion shape**: per-machine projections AND the composed view are both available to the harness. The harness exposes `harness.j002.assert_project_context_state(name)`, `harness.j002.assert_session_chat_state(name)`, and `harness.j002.assert_scope(expected)` (where `assert_scope` reads the composed view). Legacy `harness.j002.assert_state(name)` continues to work by inspecting both projections (DWD-13 §RD13-3 mitigation).

---

## 8. ScopeResolver invariants — J-002's call sites (post-DWD-13)

> **Source contract**: ADR-029 §1 invariants 1-5 + `ui-state/lib/active-scope.ts:80-142`.

The pure-function ScopeResolver at `active-scope.ts` is **byte-unchanged by J-002**. J-002 calls it at three explicit boundaries — now distributed across the two machines per DWD-13:

| Call site | Owning machine | Invariants exercised | Outcome on violation |
|---|---|---|---|
| `resolveInitialScope` actor in `resolving_initial_scope` state | **project-context** | I1 (org parity), I4 (cross-tenant project) | I4 violation → return `{cross_tenant: true}` → `scope_mismatch_terminal` (US-204) |
| `switchProject` actor in `switching_project` state | **project-context** | I1, I4 (the new project's tenant) | Same as above (US-207 cross-tenant edge) |
| `switchDatasetContext` actor in `switching_dataset_context` state | **session-chat** | I3 (resource pair atomic), I4 (cross-tenant/cross-project dataset) | I3 violation degrades to project-only scope (no error); I4 violation → resolve with `{dataset_access_denied: true}` → transition back to `session_active` with prior `context.resource` (US-209) |

**No new invariant is introduced.** J-002 exercises invariants **I1, I3, I4** in new call sites; the resolver is correct by construction for those sites because it operates on `(route, jwt, machineContext)` triples and the existing invariants apply unchanged.

**Invariant I5 (stale-link reconciliation for project-rename-while-bookmarked) is NOT exercised by J-002 in PR-0.** I5's mechanism (`active-scope.ts:125-130`) requires the optional `machineContext.{bookmarked_project_name, current_project_name}` fields to be populated. J-002's machine context (§2.1's `J002MachineContext`) does NOT populate these fields, because none of US-201..US-210 describes a "project was renamed since the bookmark was saved" case — the J-002 deep-link failure modes are I4-shaped (cross_tenant, project_not_found, access_revoked), not I5-shaped (rename-drift). J-002's resolver call sites therefore pass the default empty `machineContext` (`active-scope.ts:83`).

The `scope_reconciled` FlowEvent referenced in the journey YAML for `switching_dataset_context` is the observability emission already produced by the existing `deep_link_opened` projection handler at `projection.ts:201-220` with `reconciled: false` — it is not an I5 emission. ([DWD-12 ratifies that future J-NNN flows can populate the I5 fields and exercise I5 without changing the resolver.](./wave-decisions.md))

---

## 9. Per-slice mapping (the design surface each slice touches; post-DWD-13)

> **Source contract**: `docs/feature/project-and-chat-session-management/discuss/slices/slice-{01..06}-*.md`.

Per DWD-13, the slice plan is amended with a new **MR-1.5 (refactor)** between the SHIPPED MR-1 and the not-yet-started MR-2. Subsequent MRs touch the machine indicated.

| MR | Machine(s) touched | Design surfaces touched | Reversibility (rollback shape) |
|---|---|---|---|
| **MR-1** *(SHIPPED at `cd4103e` 2026-05-13)* | (pre-split single machine, awaiting MR-1.5 refactor) | (1) Single machine file `ui-state/lib/machines/project-and-chat-session-management.ts` with 5 states (`resolving_initial_scope`, `no_projects_empty_state`, `creating_project`, `project_selected`, `scope_mismatch_terminal`, `error_recoverable`). (2) Orchestrator machine-registry refactor (DWD-8) shipped. (3) `j001_ready` broadcast hook shipped (DWD-6). (4) `projection.ts` dispatch-table extension for the 5-state subset. (5) `frontend/app/root.tsx` root loader (§6.1). (6) Loaders on `routes/project-detail.tsx` and `routes/projects.tsx`. (7) `uiStateClient` methods. | (Already shipped; the MR-1.5 refactor restructures without behavior change.) |
| **MR-1.5** *(NEW per DWD-13 — pure refactor; recommended sequencing per DWD-13's "How to apply")* | Both | (1) **Split** `project-and-chat-session-management.ts` into `project-context.ts` (5 states subset; renames per §2.1.A) and `session-chat.ts` (stub with only `waiting_for_project` initial state). (2) Orchestrator: **add `project_ready` broadcast hook** alongside existing `j001_ready` hook; add `session-chat` registry entry. (3) `projection.ts`: namespace `EVENT_HANDLERS` per-machine (§7.3); `flow_id`-routed dispatch. (4) `frontend/app/lib/ui-state-client.ts`: split `getJ002Projection` into `getProjectContextProjection` + `getSessionChatProjection` + composer. (5) FE loaders: call composer instead of single-projection method. (6) TS harness: `harness.j002.*` namespace gains `assert_state_in(machine, name)`; legacy `assert_state(name)` is backed by union over both projections. | Revert the split MR — the single-machine file returns from git history; the orchestrator's second hook is removed; all MR-1 behavior is preserved either way (the refactor preserves behavior by construction). **All MR-1 acceptance tests must pass against the post-split code with zero modification** — if they don't, the refactor is reverted before MR-2 begins. |
| **MR-2** — session list + resume (US-203, US-205) | session-chat | (1) session-chat extends from `waiting_for_project` stub to add 4 states: `loading_session_list`, `session_list_visible`, `resuming_session`, `session_active`. (2) **Alembic migration 009** adds `session.active_dataset_id` column (DWD-2). (3) `update_session.py` allowlist extension. (4) Loaders on `routes/chat.tsx` and `routes/sessions.tsx`. (5) TWO Projection stream SSE endpoints (per machine; DWD-9 + DWD-13). (6) `SESSION_CHAT_EVENT_HANDLERS` dispatch-table extension for session-list/resume events. **project-context byte-unchanged by MR-2.** | Drop the migration → drop the use-case allowlist line → drop the SSE endpoint → drop the three loaders → session-chat stays in `waiting_for_project` after receiving `project_ready` (graceful: no session-list rendering yet). project-context keeps working unmodified. **Cross-slice gate**: Slice 2 cannot DELIVER until DWD-2 lands AND migration 009 is applied to all envs. |
| **MR-3** — new session lifecycle (US-206) | session-chat | (1) session-chat adds `session_active_no_messages` state. (2) Projection dispatch-table extension for `session_welcome_displayed`, `session_active_reached`. (3) FE composer-state preservation contract (no code change required per §6.4 — relies on component-local state). | Remove the state from session-chat — `new_session_clicked` falls through to current behavior (`session_active` via eager-create) per US-206 edge cases reverting cleanly. project-context untouched. |
| **MR-4** — project switching + agent contract (US-207, US-208) | project-context, agent, FE composer | (1) project-context adds `switching_project` state. (2) `uiStateClient.activeScopeHeader` composer pattern lands (post-MR-1.5 the composer exists; MR-4 wires it into every outbound fetch from loader-emitted HTTP). (3) **Agent middleware refactor** in `agent/lib/chat/handleChat.ts` (per §4) — unchanged by DWD-13 (agent doesn't know about the split). (4) Backwards-compat flag `SCOPE_HEADER_FALLBACK_ENABLED` with compile-time sunset. (5) ESLint rule extension. (6) project-context's `switching_project → project_selected` re-entry triggers `project_ready` re-broadcast → session-chat invalidates `session_id`+`resource_*` via §3.2's idempotent-with-different-project_id path (no session-chat code change; the handler already exists from MR-1.5). | Flag `SCOPE_HEADER_FALLBACK_ENABLED=true` permanently disables the header-only enforcement (the legacy body path keeps working). Sunset date can be pushed via one-line edit if legacy clients aren't migrated; **the rollback shape is "extend the migration window," not "revert the slice."** |
| **MR-5** — dataset context switching (US-209) | session-chat | (1) session-chat adds `switching_dataset_context` state + 2 event handlers in `session_active`. (2) Projection dispatch-table extension for `switching_dataset_context_started`, `dataset_attached`, `dataset_access_denied`. (3) Chat-view component gains one-line emit on `data-agent-request` typed-part handler. (4) Backend's `update_session.py` write of `active_dataset_id` (Slice 2 prerequisite). **project-context byte-unchanged by MR-5.** | Remove the state → the FE's `data-agent-request` handler reverts to today's behavior (re-submits chat turn with new contextId on the body; cross-tenant safety degrades to today's level — acceptable transient). |
| **MR-6** — cross-machine FREEZE/THAW (US-210) | Both | (1) BOTH machines declare top-level `on.FREEZE` + the `freeze` side-state with `on.THAW → last_live_state` history target. (2) Projection dispatch-table extensions for `project_context_frozen`, `session_chat_frozen`, `project_context_thawed`, `session_chat_thawed`, `stale_intent_dropped_after_thaw`. (3) Per-intent stale-intent guards (DWD-7) live on the relevant machine (project-context's project intents; session-chat's session/dataset intents). **The orchestrator's broadcast logic is BYTE-UNCHANGED** — it enumerates all spawned actors regardless of machine; both J-002 actors are added by MR-1.5's machine registry, so by MR-6 the broadcast already reaches both. | Remove the FREEZE handler from either machine → mid-mutation token expiries in THAT domain surface as generic 401 errors (today's UX baseline) → reverts to pre-J-002 behavior for those edge cases without disturbing the substrate. The two machines roll back independently. |

**Sequencing constraint**: MRs must DELIVER in order 1 → 1.5 → 2 → 3 → 4 → 5 → 6 because:
- MR-1.5 depends on MR-1 (the source file being split must exist and be stable).
- MR-2 depends on MR-1.5 (session-chat must exist with `waiting_for_project` initial state and the `project_ready` hook).
- MR-3's `session_active_no_messages` is reached from MR-2's `session_list_visible`.
- MR-4's `switching_project` invalidates `session_id` (MR-2's) and `resource_*` (MR-5 — but the invalidation works against a NULL value before MR-5 lands).
- MR-5 writes `session.active_dataset_id` which MR-2 reads on resume — MR-5 effectively closes the loop MR-2 opens.
- MR-6 needs MR-1.5..MR-5's mutations to FREEZE.

---

## 10. Error boundaries + recoverable states (post-DWD-13: per-machine ownership)

J-002 inherits J-001's `error_recoverable` shape verbatim, but **per DWD-13 each machine has its OWN `error_recoverable` state**. The two are NEVER conflated:

- project-context's `error_recoverable` covers project-level transient failures (create_project 5xx, resolveInitialScope 5xx, switchProject 5xx, get_project 5xx). Retry targets: `creating_project`, `resolving_initial_scope`, `switching_project`. Composer-state preserved: `pending_project_name`.
- session-chat's `error_recoverable` covers session-level transient failures (loadSessionList 5xx, resumeSession 5xx, createSessionEagerly 5xx, switchDatasetContext 5xx). Retry targets: `loading_session_list`, `resuming_session`, `session_active_no_messages`, `switching_dataset_context`. Composer-state preserved: `pending_first_message`.

The split is sound because the two retry contracts are disjoint: each retry re-enters a state that lives in the same machine; the orchestrator never has to mediate "which retry target." This is the structural argument that error_recoverable is NOT an orchestrator-level concern (DWD-13 §"What was rejected, and why").

The full failure-mode table below maps each failure to its owning machine.

| Failure mode | Owning machine | State entered | Cause tag | UX | Retry contract |
|---|---|---|---|---|---|
| `j002_no_projects_in_org` | project-context | `no_projects_empty_state` | `no_projects` | Welcoming "Create your first project" panel | Not an error — primary CTA is "Create project" |
| `j002_stale_deep_link_cross_tenant` | project-context | `scope_mismatch_terminal` | `cross_tenant` | "This project is no longer accessible" + correlation_id + "Back to projects" CTA | "Back to projects" re-enters `resolving_initial_scope` with intent cleared |
| `j002_stale_deep_link_project_not_found` | project-context | `scope_mismatch_terminal` | `project_not_found` | Same panel; different copy variant tag | Same |
| `j002_stale_deep_link_access_revoked` | project-context | `scope_mismatch_terminal` | `access_revoked` | Same panel; different copy variant tag | Same |
| `j002_session_not_found` | session-chat | `session_list_visible` (graceful) | (no panel — silent recovery) | The session disappears from the list on next projection refresh | None — the list IS the recovery surface |
| `j002_dataset_access_denied` | session-chat | `session_active` (graceful — `context.resource` UNCHANGED) | `dataset_access_denied` | Inline copy "you don't have access to that dataset" in chat input gutter | None — the prior dataset stays attached |
| `j002_list_sessions_transient_failure` | session-chat | session-chat's `error_recoverable` | `list_sessions_degraded` | "We couldn't load your sessions. Try again." + correlation_id | `retry_clicked` re-enters `loading_session_list` |
| `j002_create_project_validation_failed` | project-context | `no_projects_empty_state` | (no panel — inline form error) | Inline form-field error | The user edits and re-submits |
| `j002_create_project_transient_failure` | project-context | project-context's `error_recoverable` | `transient` | "We couldn't create the project. Try again." + correlation_id | `retry_clicked` re-enters `creating_project` |
| `j002_token_expired_during_mutation` | both (each enters its own `freeze`) | `freeze` (US-210) | (no panel — banner overlay) | "Refreshing your session..." banner; prior state's last paint visible underneath | None — silent recovery via orchestrator replay; each machine restores via its own `last_live_state` |
| `j002_replay_abandoned` (5s timeout, no THAW) | both (each enters its own `error_recoverable`) | `error_recoverable` (the owning machine's) | `replay_abandoned` | "We couldn't complete that action — try again." + correlation_id | `retry_clicked` re-enters originating state via the owning machine's `last_live_state` |

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
| `FlowOrchestrator` | `ui-state/lib/orchestrator.ts` | Spawns flow actors; broadcasts FREEZE/THAW; owns replay buffer; owns `priorState` watcher + `j001_ready` hook | **EXTEND** | (a) Add MachineRegistry entry for `session-chat` (DWD-8 was the table; now has 3 entries). (b) Add `project_ready` broadcast hook alongside existing `j001_ready` hook (DWD-13 §3.2) — analogous pattern; ~15 LOC. **NOT a new orchestrator** — the broadcast loop and replay buffer are unchanged. |
| `LoginAndOrgSetupMachine` | `ui-state/lib/machines/login-and-org-setup.ts` | Per-flow XState v5 state-chart with FREEZE/THAW handlers | **CREATE NEW** sibling file `ui-state/lib/machines/project-context.ts` AND second sibling file `ui-state/lib/machines/session-chat.ts` (per DWD-13) | ADR-028:46-48 forbids machine-to-machine imports. The two J-002 flows are independent actors per the actor model + DWD-13's bounded-responsibility convention. Reuse via shared types only (`ActiveScope`, `ResourceType`, possibly `TranscriptMessage`/`SessionSummary` if extracted to a shared module). |
| `buildProjection` + `EVENT_HANDLERS` | `ui-state/lib/projection.ts:107-242` | Pure fold from `FlowEvent[]` to `FlowProjection` | **EXTEND** | Per DWD-13 §7.3: namespace `EVENT_HANDLERS` per-machine (`PROJECT_CONTEXT_EVENT_HANDLERS` + `SESSION_CHAT_EVENT_HANDLERS`); route the dispatch by `flow_id` prefix. The pure fold (`applyEvent`, `buildProjection`) remains unchanged. ~25 new entries across both tables; 0 changes to the fold. |
| `resolveActiveScope` | `ui-state/lib/active-scope.ts:80-142` | Pure-function scope resolution per ADR-029 invariants 1-5 | **REUSE VERBATIM** | Both J-002 machines' call sites pass the same `(route, jwt, machineContext)` triple shape. Zero changes to the resolver. |
| `FlowEventLog` port + Redis adapter | `ui-state/lib/persistence/redis.ts` | Append-only event log per ADR-018 dispatch | **REUSE VERBATIM** | TWO new key prefixes (`ui-state:project-context:<principal>:events` AND `ui-state:session-chat:<principal>:events`), but the port is unchanged. Per-principal cardinality remains O(1). |
| `FlowProjection` envelope shape | `ui-state/lib/projection.ts:22-30` | Wire format: `{flow_id, state, context, active_scope, ...}` | **REUSE VERBATIM** | The two J-002 machines are second AND third tenants of the same envelope. `context` is opaque to the envelope, so each machine's flow-specific shape is invisible at the wire layer. |
| `uiStateClient` | `frontend/app/lib/ui-state-client.ts` | HTTP client to ui-state tier | **EXTEND** | Add 4 per-machine methods + 1 composer + 1 X-Active-Scope writer (`getProjectContextProjection`, `getSessionChatProjection`, `postProjectContextEvent`, `postSessionChatEvent`, `getJ002Projection` composer, `activeScopeHeader`). ~50 new LOC. The existing `getProjection` method stays for J-001. |
| `frontend/app/root.tsx` | same | RRv7 root component | **EXTEND** | Add a `loader` export (Slice 1; §6.1). The existing component body stays unchanged. ~25 LOC added. (Unchanged by DWD-13 — the root loader reads J-001 only.) |
| `agent/lib/chat/handleChat.ts` | same | Chat-turn entry point | **EXTEND** | Add `extractActiveScope` helper + refactor the body destructure to honor header-first; ~50 LOC delta. **DO NOT** convert to Hono middleware (per §4.4 rationale). **Unchanged by DWD-13** — the agent receives a single composed scope header; the J-002 split is invisible to the agent. |
| `update_session` use case | `backend/app/use_cases/session/update_session.py` | Session metadata writes | **EXTEND** | Add `"active_dataset_id"` to the allowlist; one-line change. No new use case. (Unchanged by DWD-13.) |
| Session SQLAlchemy model | `backend/app/repositories/metadata/session_record.py` | Session row schema | **EXTEND** | Add `active_dataset_id: Mapped[str \| None]` column. Migration 009 (MR-2). (Unchanged by DWD-13.) |
| ScopeResolver fn signature | `ui-state/lib/active-scope.ts:80` | `(route, jwt, machineContext) → ScopeResolution` | **REUSE VERBATIM** | The new J-002 call sites need the same triple shape; no signature change. |
| Redis Streams `XREAD BLOCK` consumer pattern | `ui-state/lib/persistence/redis.ts` (used today for XADD/XRANGE writes; reads are XRANGE-only) | SSE projection-stream endpoint (MR-2, DWD-9 + DWD-13) | **EXTEND adapter** with one new method `subscribe(key, since: sequenceId): AsyncIterable<FlowEvent>` | Idiomatic Redis Streams pattern (`XREAD BLOCK`). Adapter probe extends to cover the subscribe path. The same method serves BOTH J-002 machines' SSE endpoints. |
| TS `UserFlowHarness` | `tests/acceptance/user-flow-state-machines/.../harness.ts` (J-001 deliverable) | Headless flow driver | **EXTEND** with `harness.j002.*` namespace | Per DWD-13: namespace gains `assert_state_in(machine, name)`, `assert_project_context_state(name)`, `assert_session_chat_state(name)` alongside the legacy `assert_state(name)` (union over both projections). |
| Python `DatasetLayerHarness` | `backend/tests/integration/dataset_layer/harness.py` | Backend+agent integration driver | **EXTEND** with `chat_turn_with_scope_header(scope, message)` method per US-208 acceptance | The new method is one method on the existing class; no fork. (Unchanged by DWD-13.) |

**Reuse summary** (post-DWD-13): J-002 introduces exactly **4 new files** (`ui-state/lib/machines/project-context.ts` machine; `ui-state/lib/machines/session-chat.ts` machine; `agent/lib/chat/scope.ts` helper; `backend/migrations/versions/009_add_session_active_dataset_id.py`) and **9 file extensions**. Net new abstractions: zero. Net new ports: zero. Net new adapters: zero (the SSE-subscribe is a method extension on `RedisFlowEventLog`, not a new adapter). **One MORE new file than the pre-amendment count** — the split is precisely the second machine file, structurally justified by ADR-028:46-48 + DWD-13.

**No CREATE NEW decision lacks justification.** The three CREATE NEW entries (the two J-002 machine files; the agent scope helper) are each forced — by ADR-028:46-48 (machine independence) + DWD-13 (bounded-responsibility convention) and by handleChat's existing structure respectively. No "extend would create too much coupling" handwaves are present.

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
- Sibling DESIGN artifacts (this wave + amendment): `wave-decisions.md` (DWD-1..DWD-13), `c4-diagrams.md`, `handoff-design-to-distill.md`
- **SRP review (binding input for the amendment)**: `./review-by-software-crafter-srp.md`
- **DESIGN amendment review**: `./review-by-solution-architect-srp-amendment.md`
