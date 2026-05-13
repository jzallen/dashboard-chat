# C4 Diagrams — `project-and-chat-session-management` (J-002)

> **Wave**: DESIGN
> **Date**: 2026-05-13
> **Architect**: nw-solution-architect (J-002 DESIGN wave)
> **Companion**: `application-architecture.md` (binding architecture); `wave-decisions.md` (DWD-1..DWD-12).

This document provides the C4 model artifacts for J-002:
- **§1 Container Diagram (L2)** — J-002 deltas vs the live topology.
- **§2 Component Diagram (L3)** — inside `ui-state/` for J-002 + cross-machine orchestration with J-001.
- **§3 State Chart** — the 14-state J-002 machine with all transitions.
- **§4 Sequence Diagrams** — one per carpaccio slice (canonical happy path each).

Existing system-context (L1) is byte-unchanged from J-001 (see `docs/evolution/2026-05-12-user-flow-state-machines/design/c4-diagrams.md` §1); J-002 introduces no new external systems.

---

## 1. Container Diagram (L2) — J-002 deltas

```mermaid
C4Container
  title Container Diagram — Dashboard Chat with J-002 (project-and-chat-session-management)
  Person(user, "End User", "Maya Chen — returning user, deep-link visitor, or first-time-in-org")
  Person(dev, "Developer (test author)", "Drives J-002 headlessly via TS UserFlowHarness")

  Container_Boundary(c1, "Dashboard Chat") {
    Container(reverseproxy, "reverse-proxy (nginx)", "nginx:alpine", "Serves dist/client/ static + proxies /api/* /worker/* /assets/*; new rule routes non-static, non-API to web-ssr (per ADR-034)")
    Container(webssr, "web-ssr (NEW per ADR-034)", "Hono + RRv7 framework mode (Node)", "Hosts the RRv7 SSR request handler; J-002-territory routes' loaders run here")
    Container(authproxy, "auth-proxy", "Hono + jose", "Sole production ingress for backend + ui-state; JWT verification; identity-header injection (UNCHANGED by J-002)")
    Container(uistate, "ui-state tier", "Hono + XState v5 actor model", "<<J-002 EXTENSION>> Hosts BOTH login-and-org-setup AND project-and-chat-session-management machines via the orchestrator's new MachineRegistry strategy table (DWD-8). Same Redis log; new key prefix ui-state:project-and-chat-session-management:&lt;principal_id&gt;:events")
    Container(agent, "agent", "Hono + Groq SSE", "<<J-002 EXTENSION>> Chat brain — UNCHANGED in scope (D8 preserved). One refactor: handleChat.ts reads org_id/project_id/resource_* from X-Active-Scope header (per DWD-3); body project_id is one-release backward-compat fallback with compile-time sunset")
    Container(backend, "backend", "FastAPI + SQLAlchemy + DuckDB", "<<J-002 EXTENSION>> One Alembic migration (009) adds session.active_dataset_id column. update_session use case allowlist extended by one field (DWD-2)")
    ContainerDb(redis, "Redis", "Redis 7", "<<J-002 EXTENSION>> New key prefix ui-state:project-and-chat-session-management:&lt;principal_id&gt;:events; same dispatch as J-001 per ADR-018 inheritance. NEW Redis Streams XREAD BLOCK consumer for the SSE projection-stream endpoint (DWD-9; Slice 2)")
    ContainerDb(postgres, "Postgres (dev: SQLite)", "Postgres 16", "<<J-002 EXTENSION>> sessions table gains active_dataset_id nullable column (migration 009)")
    ContainerDb(minio, "MinIO", "S3-compatible", "Parquet datalake (UNCHANGED)")
    Container(queryengine, "query-engine", "pg_duckdb", "UNCHANGED")
  }

  System_Ext(workos, "WorkOS", "Identity provider (UNCHANGED)")
  System_Ext(groq, "Groq", "LLM provider (UNCHANGED)")

  Rel(user, reverseproxy, "Loads UI from", "HTTPS")
  Rel(reverseproxy, webssr, "Proxies non-static, non-API routes to (per ADR-034)", "HTTP")
  Rel(webssr, authproxy, "Server-side loader fetches through (J-002 loaders read J-002 projection)", "HTTPS + X-Active-Scope header")
  Rel(dev, authproxy, "Drives flows via TS UserFlowHarness through", "HTTPS")
  Rel(authproxy, uistate, "Forwards /ui-state/flow/project-and-chat-session-management/* (J-002 endpoints)", "HTTPS")
  Rel(authproxy, agent, "Forwards /chat (with X-Active-Scope header from FE per DWD-3)", "HTTPS + SSE")
  Rel(authproxy, backend, "Forwards /api/* (UNCHANGED)", "HTTPS")
  Rel(uistate, backend, "Invokes list_projects, list_sessions, get_session, get_project, create_project, create_session, update_session, list_session_events (per J-002 actors)", "HTTPS")
  Rel(uistate, redis, "XADD per J-002 transition; XRANGE for projection read; XREAD BLOCK for SSE stream (Slice 2)", "RESP")
  Rel(agent, redis, "Appends DomainEvents + UiDirectives (UNCHANGED)", "RESP")
  Rel(agent, groq, "Streams completions from (UNCHANGED)", "HTTPS + SSE")
  Rel(backend, redis, "Reads session-event log for replay (UNCHANGED — noop today)", "RESP")
  Rel(backend, postgres, "Reads/writes session + project tables (active_dataset_id column added by migration 009)", "Postgres protocol")
  Rel(backend, minio, "Reads/writes Parquet (UNCHANGED)", "S3")
  Rel(backend, queryengine, "Materializes previews (UNCHANGED)", "Postgres protocol")
  Rel(uistate, workos, "OIDC code exchange during J-001 authenticating (UNCHANGED — J-002 inherits)", "HTTPS")
```

### 1.1 What this diagram shows

- **No new containers.** J-002 lands inside the existing 7-service compose topology ratified by ADR-030 + ADR-034. Zero new deployables.
- **`ui-state` is the load-bearing extension point** — gains a second machine, gains the SSE projection-stream endpoint (Slice 2 / DWD-9), gains the MachineRegistry refactor.
- **`agent` is extended in one place** — `handleChat.ts` reads scope from header. The Groq SSE, tool dispatch, ADR-015 directive log are all unchanged (D8 preserved).
- **`backend` is extended in one column** — migration 009 + `update_session` allowlist. No new use case.
- **`web-ssr` gains 5 new loaders** in the existing frontend source tree (per ADR-034 framework-mode-route-graduation pattern). No new container; no new routes file.

### 1.2 What this diagram does NOT change (vs the J-001 container diagram)

- All container boundaries.
- All inter-container relationships (every arrow's protocol and direction).
- The Redis key-prefix tenancy pattern (one prefix per flow type).
- The auth-proxy's role as sole ingress.
- WorkOS, Groq, MinIO usage.

---

## 2. Component Diagram (L3) — ui-state internals + cross-machine orchestration

```mermaid
C4Component
  title Component Diagram — ui-state tier (J-002 + cross-machine composition with J-001)

  Container_Boundary(uistate, "ui-state tier (Hono on Node)") {
    Component(routes, "Flow Routes", "Hono handlers — index.ts", "<<J-002 EXTENSION>>: handles /ui-state/flow/project-and-chat-session-management/{begin,event,projection,open-deep-link} via the same wireRoutes pattern. NEW: /projection/stream SSE handler (DWD-9; Slice 2)")
    Component(orchestrator, "Flow Orchestrator", "orchestrator.ts — supervisor actor", "<<J-002 EXTENSION>>: NEW MachineRegistry strategy table replaces hardcoded conditional (DWD-8). Existing FREEZE/THAW broadcast logic is byte-unchanged — enumerates all spawned actors. Watches J-001 priorState→ready transition to spawn J-002 actor and emit j001_ready event")
    Component(loginmachine, "LoginAndOrgSetupMachine", "machines/login-and-org-setup.ts — XState v5 statechart (J-001)", "8 states; UNCHANGED by J-002. Provides org_id + user.display_name to J-002 via orchestrator broadcast on ready entry")
    Component(j002machine, "<<NEW>> ProjectAndChatSessionMachine", "machines/project-and-chat-session-management.ts — XState v5 statechart (J-002)", "14 states (12 narrative + error_recoverable + freeze); top-level on.FREEZE handler reachable from every non-terminal state (DWD-6); guards on intent replay implement stale-intent filter (DWD-7)")
    Component(scoperesolver, "ScopeResolver", "active-scope.ts — pure fn (route, jwt, machineContext) → ActiveScope", "BYTE-UNCHANGED by J-002. J-002 adds 3 new call sites (resolveInitialScope, switchProject, switchDatasetContext actors)")
    Component(projectionbuilder, "ProjectionBuilder", "projection.ts — pure fold (FlowEvent[], snapshot?) → FlowProjection", "<<J-002 EXTENSION>>: EVENT_HANDLERS dispatch table extended with ~16 new entries (one per J-002 event type per the journey YAML emits blocks). Envelope shape unchanged (DWD-9)")
    Component(eventlog, "FlowEventLog port", "persistence/redis.ts — append-only XADD/XRANGE", "<<J-002 EXTENSION>>: NEW subscribe(key, since: sequenceId): AsyncIterable&lt;FlowEvent&gt; method using Redis Streams XREAD BLOCK — backs the SSE stream endpoint (Slice 2)")
    Component(replaybuffer, "ReplayBuffer", "orchestrator.ts:54-56,161-192 — bounded queue", "5s timeout, 16 max queued per flow. BYTE-UNCHANGED by J-002. J-002 is the first CONSUMER (per ADR-028 §94)")
    Component(probe, "probe()", "Earned-Trust startup checks", "BYTE-UNCHANGED by J-002. Adapter probes (Redis, auth-proxy, backend, WorkOS) cover both flows uniformly")
    Component(j002factory, "<<NEW>> createProjectAndChatSessionMachine", "machines/project-and-chat-session-management.ts factory", "Sibling of createLoginAndOrgSetupMachine; injected with deps for resolveInitialScope, createProject, loadSessionList, resumeSession, createSessionEagerly, switchDatasetContext, switchProject actors. Per ADR-028 v5 actor model setup({actors: {...}}).createMachine pattern")
  }

  ContainerDb_Ext(redis, "Redis")
  Container_Ext(authproxy, "Auth-Proxy")
  Container_Ext(backend, "Backend")

  Rel(routes, orchestrator, "Dispatches flow events to (begin / send / open-deep-link / projection-read / SSE-subscribe)")
  Rel(orchestrator, loginmachine, "Spawns + sends events to (existing)")
  Rel(orchestrator, j002factory, "<<NEW>> Calls factory on principal's first J-002 event OR on J-001 ready broadcast")
  Rel(j002factory, j002machine, "<<NEW>> Creates machine instance per (flow_id, principal_id) — setup({actors}).createMachine pattern per ADR-028")
  Rel(orchestrator, j002machine, "Broadcasts FREEZE on J-001 expired_token; broadcasts THAW on J-001 silent_reauth_ok; replays queued intents from ReplayBuffer")
  Rel(j002machine, eventlog, "Appends DomainEvents per transition (ui-state:project-and-chat-session-management:&lt;principal_id&gt;:events)")
  Rel(j002machine, scoperesolver, "Calls in 3 actors (resolveInitialScope, switchProject, switchDatasetContext)")
  Rel(j002machine, backend, "Invokes list_projects, list_sessions, get_session, get_project, create_project, create_session, update_session, list_session_events via HTTPS", "HTTPS via authproxy")
  Rel(loginmachine, scoperesolver, "Calls (existing)")
  Rel(loginmachine, eventlog, "Appends DomainEvents (existing key prefix)")
  Rel(orchestrator, replaybuffer, "Owns; queues intents during FREEZE window per flow")
  Rel(routes, projectionbuilder, "Folds events for GET /projection (HTTP) and for each SSE push (Slice 2)")
  Rel(projectionbuilder, eventlog, "Reads via XRANGE (HTTP projection); via subscribe (SSE)")
  Rel(eventlog, redis, "Persists to / reads from")
  Rel(probe, redis, "Pings on startup")
  Rel(probe, authproxy, "Verifies token-validation contract on startup")
  Rel(probe, backend, "Verifies /api/health + openapi.json shape on startup")
```

### 2.1 What this diagram shows

- **`j002machine` is a NEW sibling of `loginmachine`** — same XState v5 actor-model pattern; per ADR-028:46-48 the two machines never import each other; communication is one-way via orchestrator broadcast.
- **The orchestrator's `MachineRegistry`** (DWD-8) replaces the hardcoded conditional; the registry is constructed at the composition root with both J-001 and J-002 factories.
- **The replay buffer and FREEZE/THAW broadcast logic are byte-unchanged** — the broadcast enumerates spawned actors (machine-agnostic); J-002 is just a new spawned actor.
- **`ProjectionBuilder` extends `EVENT_HANDLERS`** — strategy pattern, no fold logic change.
- **`FlowEventLog` adapter gains a `subscribe()` method** for the SSE endpoint; the existing XADD/XRANGE methods are unchanged.

### 2.2 What this diagram does NOT change

- The `routes/` → `orchestrator/` → `machines/` import-graph topology (`dependency-cruiser` rule per ADR-027 §7).
- The Earned-Trust `probe()` pattern (ADR-027 §6).
- The composition root's adapter-injection shape.
- The Redis key prefix tenancy (J-001 and J-002 use distinct prefixes; no key collision).

---

## 3. State Chart — J-002 machine (14 states + transitions)

The chart below is the IMMUTABLE journey-YAML contract expressed as XState v5 state names. Each transition's `event → target` mapping comes directly from the YAML; this view collapses the YAML's text descriptions into a graph for visual review.

```mermaid
stateDiagram-v2
    direction LR
    [*] --> resolving_initial_scope: spawned on j001_ready

    resolving_initial_scope --> project_selected: resolved_with_project
    resolving_initial_scope --> no_projects_empty_state: resolved_no_projects
    resolving_initial_scope --> scope_mismatch_terminal: scope_mismatch
    resolving_initial_scope --> freeze: FREEZE (top-level)

    no_projects_empty_state --> creating_project: create_project_clicked / create_project_submitted
    no_projects_empty_state --> freeze: FREEZE

    creating_project --> project_selected: project_created (invoke onDone)
    creating_project --> no_projects_empty_state: validation_failed (invoke onError)
    creating_project --> error_recoverable: transient_failure (invoke onError)
    creating_project --> freeze: FREEZE

    project_selected --> loading_session_list: session_list_load_started (raised on entry)
    project_selected --> switching_project: switching_project_intent
    project_selected --> freeze: FREEZE

    loading_session_list --> session_list_visible: session_list_loaded (invoke onDone)
    loading_session_list --> error_recoverable: transient_failure
    loading_session_list --> freeze: FREEZE

    session_list_visible --> resuming_session: session_clicked
    session_list_visible --> session_active_no_messages: new_session_clicked
    session_list_visible --> switching_project: switching_project_intent
    session_list_visible --> [*]: suggestion_chip_clicked_upload (exit_to_J003 — navigation side-effect)
    session_list_visible --> [*]: suggestion_chip_clicked_browse_projects (exit_to_projects_page — navigation side-effect)
    session_list_visible --> freeze: FREEZE

    resuming_session --> session_active: session_resumed (invoke onDone)
    resuming_session --> session_list_visible: session_not_found (invoke onDone, graceful)
    resuming_session --> error_recoverable: transient_failure
    resuming_session --> freeze: FREEZE

    session_active_no_messages --> session_active: first_message_sent (via createSessionEagerly invoke onDone)
    session_active_no_messages --> resuming_session: session_clicked
    session_active_no_messages --> switching_project: switching_project_intent
    session_active_no_messages --> error_recoverable: transient_failure (createSessionEagerly onError)
    session_active_no_messages --> freeze: FREEZE

    session_active --> resuming_session: session_clicked
    session_active --> session_active_no_messages: new_session_clicked
    session_active --> switching_project: switching_project_intent
    session_active --> switching_dataset_context: dataset_resolved_by_agent
    session_active --> switching_dataset_context: dataset_picked_directly
    session_active --> freeze: FREEZE

    switching_dataset_context --> session_active: dataset_attached (invoke onDone)
    switching_dataset_context --> session_active: dataset_access_denied (invoke onDone, graceful)
    switching_dataset_context --> error_recoverable: transient_failure
    switching_dataset_context --> freeze: FREEZE

    switching_project --> project_selected: project_switched (invoke onDone)
    switching_project --> scope_mismatch_terminal: cross_tenant / access_revoked (invoke onDone)
    switching_project --> error_recoverable: transient_failure
    switching_project --> freeze: FREEZE

    scope_mismatch_terminal --> resolving_initial_scope: back_to_projects_clicked

    error_recoverable --> [*]: retry_clicked (transitions to last_live_state via history target)

    freeze --> [*]: THAW (transitions to last_live_state via history target)
    freeze --> error_recoverable: replay_abandoned (5s timeout, cause replay_abandoned)
```

> **Note on collapsed state**: The journey YAML lists `no_sessions_empty_state` as one of the 12 narrative states (kind `interactive`) for emotional-arc clarity. The XState machine **does NOT create a separate state for it** — it is a derived UI predicate within `session_list_visible` when `context.session_list.length === 0`. See `application-architecture.md` §2.3 for the rationale (DWD-1).

### 3.1 Chart legend / reading guide

- `[*]` exits in `session_list_visible` are the **navigation side-effects** `exit_to_J003` and `exit_to_projects_page` from the journey YAML — they are NOT internal XState states; they fire route navigations.
- `[*]` re-entries from `error_recoverable` and `freeze` represent **history-target transitions** to `context.last_live_state` (per DWD-6, the field assigned on FREEZE entry; per the `error_recoverable` action symmetric pattern from J-001).
- The top-level `FREEZE` handler (per DWD-6 + §2.2 of application-architecture.md) is shown as a transition from every non-terminal state — visually this is redundant but it matches XState v5's `on:` top-level inheritance semantics.
- **`scope_mismatch_terminal` is terminal-recoverable** — it has an exit (`back_to_projects_clicked`) but no auto-resolution. The user must click.

### 3.2 Cross-machine signals (shown but originating outside J-002)

- `FREEZE` is emitted by the **orchestrator** when J-001 transitions to `expired_token` (per ADR-028 §"Decision outcome"). J-002 never emits FREEZE.
- `THAW` is emitted by the **orchestrator** when J-001 silent re-auth completes (J-001 transitions `expired_token → ready`). J-002 never emits THAW.
- `replay_abandoned` is emitted by the **orchestrator's replay buffer** on 5s timeout without THAW (per ADR-027 §5).

### 3.3 Match against the journey YAML

| Journey YAML state | XState state | Notes |
|---|---|---|
| `resolving_initial_scope` | ✓ same | Initial state |
| `no_projects_empty_state` | ✓ same | Sibling — not a sub-shape per DWD-1 |
| `creating_project` | ✓ same | |
| `project_selected` | ✓ same | |
| `loading_session_list` | ✓ same | |
| `session_list_visible` | ✓ same | **`no_sessions_empty_state` collapses into this** per DWD-1 |
| `no_sessions_empty_state` | (UI sub-shape; not an XState state per DWD-1) | Derived from `context.session_list.length === 0` |
| `resuming_session` | ✓ same | |
| `session_active_no_messages` | ✓ same | |
| `session_active` | ✓ same | |
| `switching_dataset_context` | ✓ same | |
| `switching_project` | ✓ same | |
| `scope_mismatch_terminal` | ✓ same | |
| `error_recoverable` | ✓ same | Same shape as J-001's |
| `freeze` | ✓ same | Side-state reachable via top-level `on.FREEZE` |
| `exit_to_J003`, `exit_to_projects_page` | (navigation events, not XState states) | Emit + side-effect |

---

## 4. Sequence Diagrams — one per slice (canonical happy path)

### 4.1 Slice 1 — Walking skeleton: cold deep-link to `/projects/q4-analytics` (US-204 happy)

```mermaid
sequenceDiagram
    actor Maya as Maya Chen
    participant Nginx as reverse-proxy (nginx)
    participant SSR as web-ssr (Hono+RRv7)
    participant AP as auth-proxy
    participant US as ui-state tier (J-002 actor)
    participant BE as backend
    participant R as Redis

    Maya->>Nginx: GET /projects/q4-analytics (cold tab, fresh JWT)
    Nginx->>SSR: proxy to web-ssr (per ADR-034 nginx rule)
    Note over SSR: RRv7 framework-mode loader runs at routes/project-detail.tsx
    SSR->>AP: POST /ui-state/flow/project-and-chat-session-management/open-deep-link {intent_project_id: "q4-analytics"} (Bearer JWT)
    AP->>US: forward + inject X-Org-Id, X-User-Id headers
    US->>US: ScopeResolver(route={project: "q4-analytics", org: "acme-data"}, jwt={org_id: "acme-data"}, ctx={})
    Note over US: I1 OK + I4 OK (project belongs to acme-data — backend authorize will gate too)
    US->>BE: GET /api/projects/q4-analytics (verify access; loads project.name)
    BE-->>US: 200 {id: "q4-analytics-id", name: "Q4 Analytics"}
    US->>R: XADD ui-state:project-and-chat-session-management:user-001:events {type: "deep_link_opened", payload: {scope, project, reconciled: false}, correlation_id}
    US->>US: J-002 machine: resolving_initial_scope --resolved_with_project--> project_selected
    US->>R: XADD ... {type: "project_selected", payload: {project_id, project_name, correlation_id}}
    Note over US: project_selected entry-action raises session_list_load_started internally; loading_session_list invokes loadSessionList
    US->>BE: GET /api/projects/q4-analytics/sessions?page_size=30
    BE-->>US: 200 {items: [4 sessions], next_cursor: null}
    US->>R: XADD ... {type: "session_list_loaded", payload: {items, next_cursor}}
    US->>US: loading_session_list --session_list_loaded--> session_list_visible
    US->>US: ProjectionBuilder folds events; emits FlowProjection
    US-->>AP: 200 FlowProjection {flow_id, state: "session_list_visible", context: {project, session_list, ...}, active_scope: {org_id, project_id, ...}}
    AP-->>SSR: same
    Note over SSR: loader returns json({active_scope, project, session_list, ...}) — RRv7 sends HTML with hydrated state
    SSR-->>Nginx: HTML + initial-state JSON (loader data)
    Nginx-->>Maya: First paint: project chip "Q4 Analytics" + session list rendered together (<300ms p95)
```

### 4.2 Slice 2 — Session resume: Maya clicks `chat-9b2a` (US-205 happy)

```mermaid
sequenceDiagram
    actor Maya as Maya Chen
    participant FE as web-ssr (chat-view component)
    participant AP as auth-proxy
    participant US as ui-state tier (J-002 actor)
    participant BE as backend
    participant R as Redis

    Note over FE: User is in session_list_visible for Q4 Analytics; clicks "chat-9b2a" in recent-sessions nav
    FE->>AP: POST /ui-state/flow/project-and-chat-session-management/event {type: "session_clicked", payload: {session_id: "chat-9b2a"}, correlation_id: "R-session-resume-..."}
    AP->>US: forward
    US->>US: J-002 machine: session_list_visible --session_clicked--> resuming_session
    US->>R: XADD ... {type: "session_resume_started", payload: {session_id, correlation_id}}
    Note over US: resuming_session invokes resumeSession actor — parallel calls list_session_events + get_session

    par Transcript load
        US->>BE: GET /api/sessions/chat-9b2a/events
        BE-->>US: 200 {events: [12 messages]}
    and Session metadata load (for active_dataset_id)
        US->>BE: GET /api/sessions/chat-9b2a
        BE-->>US: 200 {id, title, owner_id, org_id, active_dataset_id: "sales_2026-id", ...}
    end

    Note over US: active_dataset_id is set — validate dataset is still accessible
    US->>BE: GET /api/datasets/sales_2026-id
    BE-->>US: 200 {id, name: "sales_2026", project_id: "q4-analytics-id"}
    Note over US: project_id matches active scope — dataset OK
    US->>R: XADD ... {type: "session_resumed", payload: {session_id, transcript, resource: {type: "dataset", id: "sales_2026-id"}}}
    US->>US: resuming_session --session_resumed--> session_active (assigns context.session_id, context.transcript, context.resource)
    US->>US: ProjectionBuilder folds events
    US-->>AP: 200 FlowProjection {state: "session_active", context: {session_id, transcript, resource: {type: "dataset", id}, ...}, active_scope: {..., resource_type: "dataset", resource_id: "sales_2026-id"}}
    AP-->>FE: same
    Note over FE: Component re-renders from new projection. Transcript with 12 messages + dataset chip "sales_2026" appear on SAME first paint
    FE-->>Maya: chat-9b2a session resumed; conversation continues with dataset context restored
```

### 4.3 Slice 3 — New session lifecycle: lazy create on first message (US-206 happy)

```mermaid
sequenceDiagram
    actor Maya as Maya Chen
    participant FE as web-ssr (chat-view component)
    participant AP as auth-proxy
    participant US as ui-state tier (J-002 actor)
    participant BE as backend

    Note over FE: User is in session_list_visible for Q4 Analytics; clicks "+ New Session" in nav rail
    FE->>AP: POST /ui-state/flow/project-and-chat-session-management/event {type: "new_session_clicked", correlation_id}
    AP->>US: forward
    US->>US: J-002 machine: session_list_visible --new_session_clicked--> session_active_no_messages
    Note over US: NO BACKEND CALL — state is purely client-side
    US-->>AP: 200 FlowProjection {state: "session_active_no_messages", context: {project, session_id: null, ...}}
    AP-->>FE: same
    Note over FE: Component re-renders: welcome chips ("Upload CSV", "Browse Projects") + enabled chat input. session_id is null in projection

    Note over FE: Maya types "Show me top customers by revenue" and presses Enter
    FE->>AP: POST /ui-state/flow/project-and-chat-session-management/event {type: "first_message_sent", payload: {content: "Show me top customers by revenue"}, correlation_id}
    AP->>US: forward
    US->>US: J-002 machine: session_active_no_messages --first_message_sent--> createSessionEagerly invoke fires
    US->>BE: POST /api/projects/q4-analytics-id/sessions {} (creates session row)
    BE-->>US: 201 {id: "chat-new-id", title: null, ...}
    Note over US: Fire-and-forget update_session for title
    US-)BE: PATCH /api/sessions/chat-new-id {title: "Show me top customers by revenue"}
    US->>US: createSessionEagerly onDone: assign context.session_id = "chat-new-id"; transition to session_active
    US-->>AP: 200 FlowProjection {state: "session_active", context: {session_id: "chat-new-id", project, ...}, active_scope: {project_id, ...}}
    AP-->>FE: same
    Note over FE: Component re-renders: session_id is now non-null. Chat-view dispatches the first chat turn to /chat with X-Active-Scope header carrying project_id (no resource_id yet)
    FE->>AP: POST /chat (thread_id = "chat-new-id", X-Active-Scope: {org_id, project_id: "q4-analytics-id", resource_*: null})
    AP->>FE: SSE stream begins (UNCHANGED agent path)
    FE-->>Maya: Agent response streams; new session appears at top of nav with title "Show me top customers by revenue"
```

### 4.4 Slice 4 — Project switching + agent contract: Q4 → Q3 atomic (US-207 + US-208 happy)

```mermaid
sequenceDiagram
    actor Maya as Maya Chen
    participant FE as web-ssr (chat-view component)
    participant AP as auth-proxy
    participant US as ui-state tier (J-002 actor)
    participant BE as backend
    participant Agent as agent

    Note over FE: User is in session_active for Q4 Analytics with session "chat-9b2a"; in-flight chat turn streaming
    FE->>Agent: POST /chat (X-Active-Scope: {org_id, project_id: "q4-analytics-id", resource_*: ...}, thread_id: "chat-9b2a")
    Agent--)FE: SSE stream chunk 1
    Agent--)FE: SSE stream chunk 2 (mid-response)

    Note over Maya: Maya clicks "Q3 Sales" in nav rail
    FE->>AP: POST /ui-state/flow/project-and-chat-session-management/event {type: "switching_project_intent", payload: {new_project_id: "q3-sales-id"}, correlation_id}
    AP->>US: forward
    US->>US: J-002 machine: session_active --switching_project_intent--> switching_project (assigns context.session_id = null, context.resource = {type: null, id: null})
    US-->>AP: 200 FlowProjection {state: "switching_project", context: {session_id: null, resource: {null}, ...}}
    AP-->>FE: same
    Note over FE: chat-view useEffect sees state === "switching_project" → eventSource.close() — SSE stream torn down
    FE-XAgent: SSE stream closed (agent receives no further frames)

    Note over US: switching_project invokes switchProject actor — calls ScopeResolver + get_project for new id
    US->>US: ScopeResolver({org: "acme-data", project: "q3-sales-id"}, jwt, ctx) — I1 + I4 pass
    US->>BE: GET /api/projects/q3-sales-id
    BE-->>US: 200 {id: "q3-sales-id", name: "Q3 Sales"}
    US->>US: switching_project --project_switched--> project_selected (assigns context.project)
    Note over US: project_selected entry-action raises loading_session_list
    US->>BE: GET /api/projects/q3-sales-id/sessions?page_size=30
    BE-->>US: 200 {items: [...], next_cursor: ...}
    US->>US: loading_session_list --session_list_loaded--> session_list_visible
    US-->>AP: 200 FlowProjection {state: "session_list_visible", context: {project: Q3, session_list: [Q3 sessions], session_id: null, ...}, active_scope: {project_id: "q3-sales-id", ...}}
    AP-->>FE: same
    Note over FE: chat-view re-renders. URL → /chat (or /projects/q3-sales-id depending on entry path). Project chip + session list for Q3 paint together. NO Q4 session ever appears in Q3 list

    Note over Maya: Maya later sends a turn in a Q3 session — every outbound /chat carries X-Active-Scope from J-002 projection
    FE->>Agent: POST /chat (X-Active-Scope: {org_id, project_id: "q3-sales-id", ...}, thread_id: <Q3 session>)
    Note over Agent: extractActiveScope: org_id ✓, project_id ✓; X-Org-Id matches; proceed with Groq stream
```

### 4.5 Slice 5 — Dataset context switching: agent's `resolve_dataset` → user picks (US-209 happy)

```mermaid
sequenceDiagram
    actor Maya as Maya Chen
    participant FE as web-ssr (chat-view component)
    participant AP as auth-proxy
    participant Agent as agent
    participant US as ui-state tier (J-002 actor)
    participant BE as backend

    Note over FE: User is in session_active for Q4 Analytics with session "chat-9b2a", no dataset attached
    Maya->>FE: types "filter rows where age > 30"; presses Enter
    FE->>AP: POST /chat (X-Active-Scope: {org_id, project_id, resource_*: null}, thread_id: "chat-9b2a")
    AP->>Agent: forward
    Note over Agent: contextType is "project" (no resource_type); getConversationalTools includes resolve_dataset
    Agent--)FE: SSE stream → tool-input-available chunk for resolve_dataset(name: "patients")
    Note over FE: pipeChatStream intercepts; emits data-agent-request typed part
    Note over Maya: Inline list renders: ["patients_2025", "patients_archive"]; Maya clicks "patients_2025"

    FE->>AP: POST /ui-state/flow/project-and-chat-session-management/event {type: "dataset_resolved_by_agent", payload: {resource_type: "dataset", resource_id: "patients_2025-id"}, correlation_id}
    AP->>US: forward
    US->>US: J-002 machine: session_active --dataset_resolved_by_agent--> switching_dataset_context (assigns context.intent_resource_*)
    Note over US: switchDatasetContext invokes — ScopeResolver I4 + persist
    US->>BE: GET /api/datasets/patients_2025-id (verify access + project match)
    BE-->>US: 200 {id, name: "patients_2025", project_id: "q4-analytics-id"} — project matches
    US->>BE: PATCH /api/sessions/chat-9b2a {active_dataset_id: "patients_2025-id"}
    BE-->>US: 200 (write succeeded — per DWD-2 column + DWD-2 allowlist)
    US->>US: switching_dataset_context --dataset_attached--> session_active (assigns context.resource = {type: "dataset", id: "patients_2025-id"})
    US-->>AP: 200 FlowProjection {state: "session_active", context: {resource: {type: "dataset", id: "patients_2025-id"}, ...}, active_scope: {..., resource_type: "dataset", resource_id: "patients_2025-id"}}
    AP-->>FE: same
    Note over FE: chat-view re-renders: dataset chip in gutter shows "patients_2025". FE re-submits the chat turn with new scope.
    FE->>AP: POST /chat (X-Active-Scope: {org_id, project_id, resource_type: "dataset", resource_id: "patients_2025-id"}, thread_id: "chat-9b2a")
    AP->>Agent: forward
    Note over Agent: extractActiveScope: resource_type = "dataset", resource_id = "patients_2025-id" → fetches tableSchema → uses getTools(tableSchema) → dispatches filterTable
    Agent--)FE: SSE stream → filter result; conversation continues
```

### 4.6 Slice 6 — Cross-machine FREEZE/THAW: token expires during `resuming_session` (US-210 happy)

```mermaid
sequenceDiagram
    actor Maya as Maya Chen
    participant FE as web-ssr (chat-view component)
    participant AP as auth-proxy
    participant US as ui-state tier (orchestrator + J-001 actor + J-002 actor)
    participant BE as backend

    Note over FE: User is in session_list_visible; clicks chat-9b2a
    FE->>AP: POST /ui-state/flow/project-and-chat-session-management/event {type: "session_clicked", payload: {session_id: "chat-9b2a"}}
    AP->>US: forward
    US->>US: J-002 machine: session_list_visible --session_clicked--> resuming_session
    US->>BE: GET /api/sessions/chat-9b2a/events (transcript load fires)

    Note over BE: Mid-call, the JWT's expiry passes
    BE-->>US: 401 token-expired
    Note over US: J-001 machine detects 401 via auth-proxy callback; transitions ready → expired_token
    US->>US: Orchestrator: priorState[loginFlowId] === "ready" && new state === "expired_token" → broadcastFreeze(loginFlowId)
    US->>US: Orchestrator broadcasts FREEZE to all spawned children (here: J-002 actor)
    US->>US: J-002 machine: top-level on.FREEZE → freeze (assigns last_live_state = "resuming_session")
    Note over US: J-002 in freeze; the 401-response from BE is no-longer-relevant — the invoke's onError/onDone is discarded by the machine because state has moved on
    US->>R: XADD ... {type: "j002_frozen", payload: {last_live_state: "resuming_session", correlation_id}}

    Note over US: Meanwhile J-001 invokes silentReauth actor (per login-and-org-setup.ts:373-393)
    US->>AP: POST /api/auth/reissue (silent re-auth)
    AP-->>US: 200 {new JWT}
    US->>US: J-001 machine: expired_token --silent_reauth_ok--> ready
    US->>US: Orchestrator: priorState[loginFlowId] === "expired_token" && new state === "ready" → broadcastThaw(loginFlowId)
    US->>US: Orchestrator drains ReplayBuffer; queued intents replay in arrival order
    Note over US: For J-002 the queued intent is the original session_clicked
    US->>US: J-002 machine: freeze --THAW--> resuming_session (history target via last_live_state)
    US->>BE: GET /api/sessions/chat-9b2a/events (replay with fresh JWT, same correlation_id)
    BE-->>US: 200 {events: [12 messages]}
    US->>BE: GET /api/sessions/chat-9b2a
    BE-->>US: 200 {active_dataset_id, ...}
    US->>BE: GET /api/datasets/sales_2026-id
    BE-->>US: 200 {project_id matches}
    US->>US: resuming_session --session_resumed--> session_active
    US->>R: XADD ... {type: "j002_thawed", payload: {last_live_state, replayed_intents_count: 1, stale_intents_dropped_count: 0, correlation_id}}
    US-->>AP: 200 FlowProjection {state: "session_active", ...}
    AP-->>FE: same
    Note over FE: "Refreshing your session..." banner fades; chat-9b2a session active. Maya never re-clicked.
```

### 4.7 Slice notes

All six sequence diagrams share these properties (per ADR-029 §4 + ADR-031 §7 inheritance):

- **Auth-proxy is on every outbound path.** No FE → ui-state or FE → agent direct.
- **`X-Active-Scope` header is set by `uiStateClient.activeScopeHeader(projection)` on every FE outbound fetch** post-Slice-4.
- **Correlation_id threads through every emit.** The original user-action's correlation_id survives FREEZE/THAW (Slice 6) and reentry from `error_recoverable`.
- **The agent is byte-unchanged in flow logic.** Slice 4 is the only slice touching `agent/lib/chat/handleChat.ts`, and only the scope-extraction prefix.

---

## References

- Companion DESIGN docs: `application-architecture.md`, `wave-decisions.md`, `handoff-design-to-distill.md`
- Journey YAML (state contract): `docs/feature/project-and-chat-session-management/discuss/journey-project-and-chat-session-management.yaml`
- ADR-027 (ui-state tier + Remix→RRv7 framework), ADR-028 (XState v5 actor model), ADR-029 (active_scope contract), ADR-030 (topology + scaling), ADR-031 §7 (auth path), ADR-034 (frontend coexistence)
- J-001 C4 diagrams: `docs/evolution/2026-05-12-user-flow-state-machines/design/c4-diagrams.md`
- Mermaid C4 syntax: [https://mermaid.js.org/syntax/c4.html](https://mermaid.js.org/syntax/c4.html)
