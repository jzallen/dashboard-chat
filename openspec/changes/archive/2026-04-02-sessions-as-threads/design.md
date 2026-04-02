## Context

The application currently models chat sessions as independent Stream.io channels, each scoped to an organization. Sessions have no relationship to projects in the app database -- Stream is the sole source of truth for session state. The frontend creates channels directly via the Stream SDK, generates channel IDs client-side (`chat_{compactOrgId}_{sessionHash}`), and connects to the agent (Hono on port 8787) directly for chat streaming through the auth-proxy. The agent verifies identity via `X-User-Id` / `X-Org-Id` headers injected by the auth-proxy.

This design restructures sessions as threads within a project-scoped memory (Stream channel), extends the SSE protocol to support agent-initiated data requests, and adds demand-driven dataset resolution to the chat pipeline. The existing outbox event system, auth-proxy architecture, and repository patterns provide the foundation.

## Goals / Non-Goals

**Goals:**
- Every project automatically has exactly one memory (Stream channel) from the moment it's created
- Sessions are lightweight threads within a project's memory, tracked in the app database
- The agent can request additional context (dataset schemas, project metadata) mid-conversation via SSE
- Session ownership is recorded for future authorization decisions
- The frontend routes chat traffic through the auth-proxy to the agent (existing pattern)
- The thread ID gives the agent a handle to reconstruct conversation context without holding state

**Non-Goals:**
- Moving the agent behind the backend API (auth-proxy already handles auth for both services)
- Cross-project memory or session sharing
- AI summarization of prior sessions (future capability)
- Real-time collaboration within a single session (multiple users typing)
- Session permissions beyond ownership (no sharing, no org-admin overrides yet)
- Migration of existing Stream channels to the new thread-based model

## Decisions

### 1. Memory provisioning via outbox event on project creation

**Decision:** Add a `ProjectCreated` outbox event that triggers Stream channel provisioning and `project_memories` row creation. The outbox handler runs within the same transaction as project creation.

**Rationale:** The outbox pattern already exists for file uploads (`UploadFileReceived`) and transforms. Extending it to project creation keeps the event architecture consistent. The outbox guarantees the memory mapping is committed atomically with the project -- no lazy creation, no race conditions, no orphaned channels.

**Alternative considered:** Lazy memory creation on first chat access. Rejected because it introduces a "does the memory exist yet?" check on every chat interaction and creates a race condition if two users open the same project simultaneously.

**Implementation approach:**
- New event `ProjectCreated` in `app/repositories/outbox/events.py` with fields: `project_id`, `org_id`, `created_by`
- New `submit_project_created_event()` on `OutboxRepository`
- `create_project` use case emits the event after repository insert
- New use case `provision_project_memory` consumes the event: creates Stream channel (`proj_{compactOrgId}_{compactProjectId}`), inserts `project_memories` row, marks event processed
- The provisioning use case is called synchronously from `create_project` since Stream channel creation is fast and the project isn't usable without its memory

### 2. New `project_memories` and `sessions` tables

**Decision:** Two new tables following existing conventions (UUIDv7 PKs, `org_id` indexed, `String(36)` FKs with CASCADE).

**`project_memories` schema:**

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | String(36) | PK, server_default uuidv7() |
| `project_id` | String(36) | FK projects.id CASCADE, UNIQUE, NOT NULL |
| `org_id` | String(36) | Indexed, NOT NULL |
| `stream_channel_id` | String(100) | UNIQUE, NOT NULL |
| `created_at` | DateTime | NOT NULL, default UTC now |

**`sessions` schema:**

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | String(36) | PK, server_default uuidv7() |
| `memory_id` | String(36) | FK project_memories.id CASCADE, NOT NULL, indexed |
| `stream_thread_id` | String(100) | NOT NULL |
| `owner_id` | String(36) | NOT NULL, indexed |
| `title` | String(500) | Nullable, set from first message |
| `org_id` | String(36) | Indexed, NOT NULL |
| `created_at` | DateTime | NOT NULL, default UTC now |
| `last_active_at` | DateTime | NOT NULL, default UTC now |

**Rationale:** `project_memories` is a 1:1 mapping (enforced by UNIQUE on `project_id`) so the backend can resolve any project to its Stream channel without querying Stream. `sessions` tracks thread-to-memory relationships with ownership. Both tables carry `org_id` for consistent tenant scoping and to avoid joins when filtering. `stream_thread_id` is not unique-constrained at the DB level since Stream manages thread uniqueness.

**Alternative considered:** Storing memory info as columns on the `projects` table. Rejected because it couples project lifecycle to Stream integration and complicates the schema for projects that might not have chat enabled in the future.

### 3. Agent stays behind auth-proxy (not behind backend API)

**Decision:** The agent remains directly accessible through the auth-proxy, same as the backend API. Chat requests flow: frontend -> auth-proxy -> agent. The backend is not in the chat request path.

**Rationale:** The auth-proxy already verifies tokens and injects identity headers (`X-User-Id`, `X-Org-Id`, `X-User-Email`) for both the agent and backend. Routing chat through the backend would add a streaming proxy hop (latency + complexity) without meaningful security benefit. The backend would need to implement SSE passthrough, connection lifecycle management, and error propagation -- significant surface area for a service that otherwise does request/response JSON.

**Alternative considered:** Agent behind the backend API, with the backend enriching requests before forwarding. Rejected because (a) the auth-proxy already handles auth, (b) streaming proxies are complex and fragile, and (c) demand-driven data fetching via the extended SSE protocol (Decision #5) solves the enrichment problem more elegantly.

**What stays the same:**
- Auth-proxy routes `/chat` to agent, `/api` to backend (existing pattern)
- Agent trusts `X-User-Id` / `X-Org-Id` headers from auth-proxy
- Frontend uses `withEagerAuth(fetch)` for token refresh on chat requests
- Agent remains stateless

### 4. Stream channel ID format change

**Decision:** Channel IDs change from session-scoped (`chat_{compactOrgId}_{sessionHash}`) to project-scoped (`proj_{compactOrgId}_{compactProjectId}`).

**Rationale:** One channel per project. The `proj_` prefix distinguishes new channels from legacy `chat_` channels. Using `compactId` (hyphen-stripped UUID) for both components keeps IDs under Stream's 64-char limit while remaining deterministic -- the same project always maps to the same channel ID.

**Thread (session) IDs:** Generated by Stream when creating a thread reply. The `stream_thread_id` stored in the `sessions` table is the parent message ID that anchors the thread. This is created by sending an initial message to the channel and using its ID as the thread root.

### 5. Extended SSE protocol for agent-initiated data requests

**Decision:** Extend the existing Vercel AI SDK data stream protocol with a new `r:` (request) prefix that allows the agent to ask the frontend for additional context mid-conversation. The frontend fulfills the request by fetching data from the backend API and sending a follow-up chat request with the thread ID.

**Current SSE prefixes:**
- `0:"token"` -- text delta
- `9:[toolcalls]` -- tool call array
- `d:{finish}` -- stream done
- `1:"error"` -- error message

**New prefix:**
- `r:{type, params}` -- agent requests data from the frontend

**Flow:**

```
Frontend -> auth-proxy -> Agent (POST /chat with thread_id, messages)
                                   |
                         Agent determines it needs dataset schema
                                   |
                         SSE: r:{"type":"resolve_dataset","params":{"name":"patients"}}
                         SSE: d:{"finishReason":"request"}
                                   |
Frontend receives request, calls GET /api/projects/{id}/datasets/search?q=patients
                                   |
Frontend -> auth-proxy -> Agent (POST /chat with thread_id + resolved dataset context)
                                   |
                         Agent loads prior thread messages from Stream
                         Agent processes with full context
                         SSE: 0:"Here's the schema for the patients dataset..."
```

**Rationale:** This keeps the agent stateless -- it never calls external services or holds connections. The frontend is already the orchestrator (it owns the Stream SDK, manages tool execution, holds entity context). Adding a request/response cycle to the SSE protocol is a natural extension. The thread ID is the continuity mechanism: the agent can say "I'm continuing this conversation" and reconstruct context from the thread's message history.

**Key design properties:**
- The `r:` message terminates the stream (`d:{finishReason:"request"}` follows immediately)
- The frontend treats `finishReason:"request"` as "not done yet" -- it fulfills the request and re-submits
- The follow-up request includes the thread ID so the agent can load prior messages
- Request types are extensible: `resolve_dataset`, `get_schema`, `list_datasets`, etc.
- If the frontend can't fulfill a request, it sends a follow-up with an error payload; the agent responds gracefully

**Alternative considered:** Agent calls the backend API directly for data. Rejected because it makes the agent stateful (needs backend URL, auth tokens, HTTP client) and couples it to the backend's API contract. The SSE request pattern keeps the agent as a pure function: messages in, stream out.

### 6. Session creation and title management

**Decision:** Sessions are created via `POST /api/projects/{project_id}/sessions`. The backend creates the Stream thread (sends a root message to the project's channel), inserts a `sessions` row, and returns the session metadata. Session titles are set from the first user message content (truncated to 100 chars), updatable by the owner.

**Rationale:** Server-side session creation ensures the `sessions` table is always in sync with Stream threads. Title-from-first-message matches the UX pattern users expect from ChatGPT/Claude.

**Implementation approach:**
- `create_session` use case: sends a message to the project's Stream channel (creating a thread), inserts `sessions` row with `stream_thread_id` = message ID, returns session object
- `update_session` use case: allows owner to update title, updates `last_active_at`
- `list_sessions` use case: queries `sessions` table filtered by memory_id + org_id, ordered by `last_active_at` desc, cursor-paginated

### 7. Dataset resolution via SSE request protocol

**Decision:** The agent uses the extended SSE protocol (Decision #5) to resolve dataset references. When the user mentions a dataset by name, the LLM triggers a `resolve_dataset` request. The frontend fulfills it by calling the backend's dataset search endpoint, then re-submits to the agent with the resolved schema.

**Implementation approach:**
- New backend endpoint: `GET /api/projects/{project_id}/datasets/search?q={name}` -- returns matching datasets with schema summaries
- Agent receives `project_id` in the chat request payload (frontend includes it since it knows the active project)
- Agent's system prompt instructs the LLM: "If the user references a dataset by name and you don't have its schema, emit a resolve_dataset request"
- The LLM decides when resolution is needed -- no client-side NLP required
- If multiple matches, the agent streams back a message asking the user to clarify
- If exactly one match, the frontend includes the schema in the follow-up request and the agent proceeds

**Alternative considered:** Frontend pre-resolves datasets before sending to agent. Rejected because it requires the frontend to parse natural language to detect dataset references, which is the LLM's job.

### 8. Memory retrieval endpoint

**Decision:** `GET /api/projects/{project_id}/memory` returns the project's memory metadata (stream_channel_id, created_at). The frontend uses this to initialize the Stream SDK connection for the correct channel.

**Rationale:** The frontend needs the Stream channel ID to establish a real-time connection. Since memory is always created with the project, this endpoint is a simple lookup -- never 404 for valid projects (unless the project itself doesn't exist).

## Risks / Trade-offs

**[Stream thread limits]** Stream.io threads are designed for conversation threading, not as a primary organizational unit. If a project accumulates hundreds of sessions, thread query performance may degrade.
-> Mitigation: Session listing queries the app database (`sessions` table), not Stream. Stream threads are only loaded when a user opens a specific session. Monitor thread count per channel.

**[Synchronous memory provisioning]** Creating a Stream channel during project creation adds latency (~100-300ms) and an external dependency to the project creation path.
-> Mitigation: Stream channel creation is idempotent (creating an existing channel is a no-op). If Stream is down, the outbox event remains unprocessed and can be retried. Consider making provisioning async if latency becomes an issue, with the frontend polling for memory readiness.

**[Extended SSE protocol complexity]** Adding request/response semantics to SSE introduces a multi-turn conversation within a single user interaction. The frontend must handle `r:` messages, fulfill them, and re-submit -- more states to manage than a simple stream.
-> Mitigation: The `r:` protocol is opt-in per request type. Initially only `resolve_dataset` is implemented. The frontend's `readSSEStream` handler already dispatches on prefix, so adding `r:` is a localized change. The `finishReason:"request"` signal makes the state transition explicit.

**[Thread context reconstruction]** The agent loads thread messages on each request to reconstruct conversation history. For long threads, this adds latency and token cost.
-> Mitigation: The agent can cap context to the most recent N messages. Stream's message query supports pagination. Thread messages are typically short (chat turns, not documents).

**[No migration of existing sessions]** Existing `chat_*` channels in Stream are orphaned by this change. Users lose access to prior conversations.
-> Mitigation: Acceptable for the current stage (pre-production). If needed later, a migration script can query existing channels and create corresponding `sessions` rows.

**[Session-Stream consistency]** If the backend creates a `sessions` row but the Stream thread creation fails (or vice versa), the two systems diverge.
-> Mitigation: Create the Stream thread first, then insert the `sessions` row. If the DB insert fails, the orphaned Stream message is harmless. The `sessions` table is the authoritative source.

## Migration Plan

**Phase 1: Database schema (backend-only, no user-facing changes)**
1. Create Alembic migration for `project_memories` and `sessions` tables
2. Add `ProjectCreated` outbox event and provisioning use case
3. Backfill: run a one-time script to create `project_memories` rows for all existing projects
4. Deploy and verify memory provisioning works for new projects

**Phase 2: Session management API (backend + frontend)**
1. Add session CRUD endpoints (`create_session`, `list_sessions`, `update_session`)
2. Add `get_project_memory` endpoint
3. Update frontend: project selection as entry point, session list queries backend, new session creates thread
4. Deploy behind feature flag if needed

**Phase 3: Extended SSE protocol + dataset resolution**
1. Add `r:` prefix handling to the agent's SSE response
2. Update frontend `readSSEStream` to handle `r:` messages and `finishReason:"request"`
3. Add `resolve_dataset` request type to agent
4. Add dataset search endpoint to backend
5. Wire up the frontend fulfillment loop: receive request -> fetch data -> re-submit
6. Deploy and verify end-to-end dataset resolution flow

**Rollback:** Each phase is independently deployable and reversible. Phase 1-2 are additive (new tables, new endpoints). Phase 3 extends the SSE protocol but the agent only emits `r:` messages when the LLM triggers resolution -- existing conversations without dataset references are unaffected.

## Open Questions

1. **Stream thread creation pattern:** Stream threads are typically created by replying to a message. Should the "thread root" message be a system message (invisible to users) or the user's first message? System message is cleaner but adds a message the user didn't send. First-user-message is natural but requires session creation to be deferred until the user actually sends something.

2. **Backfill strategy for existing projects:** Should the backfill script run as an Alembic data migration or as a standalone management command? Data migrations in Alembic are controversial since they couple schema changes to data changes.

3. **Session `last_active_at` update frequency:** Should every message update `last_active_at`, or only session creation and explicit user actions? A pragmatic middle ground: update on session load and on first message after a 5-minute gap.

4. **SSE request timeout:** If the frontend fails to fulfill an `r:` request (network error, user navigates away), the conversation stalls. Should there be a client-side timeout that sends an error payload to the agent so it can respond gracefully?
