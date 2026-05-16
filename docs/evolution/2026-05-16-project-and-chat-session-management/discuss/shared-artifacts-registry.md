# Shared Artifacts Registry — `project-and-chat-session-management` (J-002)

> **Wave**: DISCUSS
> **Scope**: All shared artifacts surfaced by the deep-dive journey
> `project-and-chat-session-management`. Cross-cutting artifacts
> already in scope from J-001 (e.g. `active_scope`,
> `user.display_name`, `org.name`, `correlation_id`) are referenced
> here as **consumed**, not re-declared.

This registry is the integration-validation root for J-002. Every
`${variable}` that appears in J-002's TUI mockups or Gherkin
scenarios has exactly one source of truth listed here.

---

## J-002 artifacts (newly introduced or first-consumed)

### `${active_scope.project_id}` *(J-001 declared cross-cutting; J-002 is the first **producer**)*

* **Source of truth** *(after J-002 ships)*: J-002's machine state
  `state.project_id`, surfaced via the projection's `active_scope`
  envelope per ADR-029 §1.
* **Consumers**:
  - **FE app shell**: project chip (always visible once a project is
    selected) — see US-002 Round-2 reframe (`docs/evolution/2026-05-12-user-flow-state-machines/discuss/user-stories.md` US-002).
  - **FE every page in the app-shell layout**: page content scoped to
    `active_scope.project_id` (session list, dataset list, table
    view, transform settings, etc.).
  - **Chat agent (worker)**: every chat turn carries `project_id` in
    the `X-Active-Scope` header per ADR-029 §4. Agent rejects turns
    missing `project_id` with 400.
  - **Every backend write**: `project_id` matches the request's
    resource binding (cross-tenant project access is rejected per
    ADR-029 §1 invariant 4).
  - **TS harness**: `harness.user_flow.assert_scope({project_id:
    ...})` reads from the same projection the FE consumes.
* **Owner**: J-002 (this journey).
* **Integration risk**: **HIGH** — the ChatView project-context race
  named at `adr-027:14` is the canonical bug class this artifact's
  single-source-of-truth retires.
* **Validation**:
  - At every transition into `project_selected`, the FE/harness can
    read `state.project_id` from J-002's projection and it equals the
    `active_scope.project_id` returned by the ScopeResolver for the
    current route.
  - No FE component reads `project_id` from `useParams` outside a
    route loader (ESLint rule per ADR-029 §2 lint contract).
  - Every chat-agent invocation carries the same `project_id` as
    the FE shell's project chip on the same paint.
  - Stale-link reconciliation: when the URL says project A but the
    user lost access OR machine context says project B, the
    ScopeResolver returns the authoritative scope and emits a
    `scope_reconciled` FlowEvent (per ADR-029 §1 invariant 5).

### `${session.id}`

* **Source of truth**: J-002 machine state `state.session_id`,
  populated when J-002 enters `session_active` (either via
  `resuming_session` from session list OR via `creating_new_session`
  from a New-Session action followed by first-message persistence).
* **Consumers**:
  - **FE chat-view**: the chat transcript renders messages for this
    session id (via `agent/lib/chat/threadPersister.ts` + the agent's
    SSE stream).
  - **FE recent-sessions nav**: highlights the currently active
    session (`features/chat-first-ui.feature:64-68`).
  - **Chat agent**: each turn carries `thread_id` from `state.session_id`
    so per-channel directive log writes (`agent/lib/chat/handleChat.ts:111`)
    bind to the right channel.
  - **TS harness**: `harness.j002.assert_session_active(session_id)`
    reads from the projection.
* **Owner**: J-002.
* **Integration risk**: **MEDIUM** — a stale session id post-switch
  is the recurring drift class. Single-source resolution removes it.
* **Validation**:
  - When `active_scope.project_id` changes, `state.session_id` is
    invalidated to null until a new session is selected or created
    in the new project.
  - The agent's `thread_id` on chat turns equals `state.session_id`
    on the same paint.

### `${session.list}` *(read-model)*

* **Source of truth**: backend
  `list_sessions(project_id, user)` use case at
  `backend/app/use_cases/session/list_sessions.py:18-58`, called by
  J-002 on entry to `loading_session_list`. The list is paginated
  (`cursor`, `page_size=30`); J-002's projection carries the **first
  page** plus the next-cursor.
* **Consumers**:
  - **FE chat-view**: recent-sessions nav (up to 5 — first page is
    enough for that view per `features/chat-first-ui.feature:64-68`).
  - **FE Chats page**: full session list at `/sessions` route per
    `frontend/app/routes.ts:33`. **NOTE**: this route may read
    directly from `list_sessions` rather than via the J-002
    projection — DESIGN owns the decision (OQ-J002-3 in handoff).
  - **TS harness**: `harness.j002.assert_session_list_includes(session_id)`.
* **Owner**: backend `metadata_repository`; J-002 reads-and-projects.
* **Integration risk**: **MEDIUM** — list pagination across project
  switches must NOT leak project A's sessions into project B's
  cache. The list is keyed by `(org_id, project_id, cursor)`.
* **Validation**:
  - The session list rendered for project B does not include any
    rows with `project_id = A`.
  - The list refreshes when `active_scope.project_id` changes; stale
    list display is a transition failure, not a silent shrug.

### `${session.title}`

* **Source of truth**: the session row's `title` field, populated
  from the first user message per
  `features/chat-first-ui.feature:142-145`. Editable via
  `update_session(session_id, {"title": new_title})` per
  `backend/app/use_cases/session/update_session.py:50-52`.
* **Consumers**:
  - FE recent-sessions nav (label).
  - FE Chats page (list row title).
  - FE chat-view header (above transcript).
* **Owner**: backend; J-002 reads-and-projects.
* **Integration risk**: **LOW** — single-step CRUD with no
  cross-state implication.
* **Validation**:
  - On a new session's first-message landing, J-002 issues the
    `update_session(title=first_message[:N])` call; the projection
    reflects the title on the next paint.

### `${session.active_dataset_id}` *(NEW shape — D11; DESIGN-deferred)*

* **Source of truth** *(target shape)*: session metadata —
  either a column on the session row, a denormalization from the
  session event stream, or a separate side-log. DESIGN chooses
  (OQ-J002-1 in handoff).
* **Consumers**:
  - **J-002 machine on session resume**: reads this and materializes
    `active_scope.resource_type = "dataset", resource_id =
    <session.active_dataset_id>`.
  - **FE chat-view gutter**: dataset chip when present
    (`features/chat-first-ui.feature:84-87`).
* **Owner**: J-002 *(produces it on dataset attach/detach within a
  session)*.
* **Integration risk**: **MEDIUM** — schema delta; if DESIGN picks
  the event-stream option (D11 option B), it requires the Stream.io
  reader from `list_session_events.py` to be wired beyond noop.
* **Validation**:
  - Session resume: `active_scope.resource_*` after resume equals
    `session.active_dataset_id` from metadata at the time of last
    write.
  - Dataset attach mid-session: an update to
    `session.active_dataset_id` is committed before the next chat
    turn's `X-Active-Scope` header is set.
  - Graceful degradation: if the stored dataset id no longer
    resolves (deleted dataset), the session resumes with
    `active_scope.resource_*` null; the chat input still works in
    conversational mode.

### `${project.name}` *(read-model)*

* **Source of truth**: the project row's `name` field, populated at
  project create-time per
  `backend/app/use_cases/project/create_project.py`. J-002 reads it
  via `get_project(project_id)` on entry to `project_selected`.
* **Consumers**:
  - FE app-shell project chip.
  - FE project-detail page header.
  - FE recent-sessions nav (project-name secondary line, when J-002
    is in the no-projects-empty-state and the recent-sessions list
    is empty).
* **Owner**: backend; J-002 reads-and-projects.
* **Integration risk**: **LOW** — single-step CRUD; no cross-state.
* **Validation**:
  - The project chip's label equals the `name` returned by
    `get_project` on the same paint.

### `${project.list}` *(read-model)*

* **Source of truth**: backend `list_projects(user)` at
  `backend/app/use_cases/project/list_projects.py:17-27`, called by
  J-002 on entry to `resolving_initial_scope` to determine the
  pre-selected project (last-used) AND to populate the project-picker.
* **Consumers**:
  - **J-002 last-used resolution logic**: J-002 picks the project
    whose most-recent session is the most-recent across all
    accessible projects. Requires the project list AND the
    most-recent-session per project.
  - FE Projects page at `/projects` per
    `frontend/app/routes.ts:20`. May read directly (OQ-J002-3).
* **Owner**: backend.
* **Integration risk**: **LOW** for J-002's own consumption.
* **Validation**:
  - Cross-tenant safety: every project in the list has
    `org_id = user.org_id`.

### `${correlation_id}` *(cross-cutting from J-001)*

* **Source of truth**: J-001's machine context per
  `docs/product/journeys/login-and-org-setup.yaml:160-167`. J-002
  inherits the value from J-001's projection on every transition
  emitting a `DomainEvent`.
* **Consumers** (added by J-002):
  - J-002's own emitted events (`project_selected`,
    `session_resumed`, `dataset_resolved_by_agent`,
    `switching_project`, etc.) carry the same `correlation_id` as
    the originating user action.
  - The `X-Correlation-Id` header on outbound calls from the Remix
    loader to the agent and to the backend.
  - Log threading across `ui-state` tier, agent, backend, and FE.
* **Owner**: J-001 (pattern); J-002 consumes verbatim.
* **Integration risk**: **MEDIUM** — same as J-001.
* **Validation**:
  - Any user action that initiates a J-002 transition (clicking a
    session, opening a project, switching dataset) mints a fresh
    `correlation_id` at the J-002 machine level, threaded through
    every subsequent emit until the transition completes.
  - Cross-machine `FREEZE` carries the J-001-originated
    `correlation_id` (the expired_token's), not a new one.

---

## Cross-cutting artifacts (carried from J-001)

### `${active_scope}` *(J-001-declared; J-002 mutates `project_id` + `resource_*`)*

See `docs/evolution/2026-05-12-user-flow-state-machines/discuss/shared-artifacts-registry.md` §`${active_scope}`
for the complete declaration (HIGH risk). J-002's contribution:

* **J-002 produces** `active_scope.project_id` and
  `active_scope.resource_type/resource_id`.
* **J-002 consumes** `active_scope.org_id` from J-001 verbatim.
* **J-002 honors** ScopeResolver invariants 1–5 from ADR-029 §1 on
  every transition.

### `${org.name}` and `${user.display_name}` *(J-001-owned)*

J-002 consumes both from the projection — no separate fetch. App-shell
chrome rendering during J-002 states uses identical values to J-001's
`ready` state (this is the K2 first-paint invariant from J-001's
outcome-kpis.md, now extended by J-002 to cover navigation within the
app shell).

---

## Validation Checks (DISCUSS-time)

* [x] Every `${variable}` in J-002's Gherkin scenarios is documented
  here or in J-001's registry.
* [x] Every shared artifact has at least one named consumer.
* [x] The new artifact `session.active_dataset_id` (D11) is flagged
  as DESIGN-deferred (OQ-J002-1 in handoff).
* [x] No two J-002 states display the same data from different
  sources (e.g., the project chip and the project-detail header
  both read from `active_scope.project_id`-resolved `project.name`,
  not from separate fetches).
* [x] Cross-state variables (`session_id` from `session_active` to
  agent's `thread_id`; `active_dataset_id` from `session_active` to
  the chat-turn's `X-Active-Scope`) have a single source of truth.
* [x] Cross-machine artifacts (`correlation_id`, `active_scope.org_id`)
  are consumed-not-redeclared.

## Validation Checks (deferred to DESIGN)

* [ ] **Session-metadata storage shape** (OQ-J002-1): column on
  session row, side-log of dataset-context changes, OR
  denormalization from session events.
* [ ] **Tab-isolated machine identity** (OQ-J002-2): does the
  J-002 `flow_id` extend from `(machine_name, principal_id)` to
  `(machine_name, principal_id, tab_id)` to handle multi-tab use?
  Today this is unsupported (single-tab assumption); flagged for
  the future.
* [ ] **Direct route vs J-002 projection for `/projects` and
  `/sessions` listing pages** (OQ-J002-3): does the Projects-grid
  page read from J-002's projection, or directly from
  `list_projects`?  Direct read is simpler but bypasses J-002's
  scope coherence guarantees.
