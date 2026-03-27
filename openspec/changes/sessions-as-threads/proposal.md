## Why

Each chat session currently creates its own Stream channel, scoped to the organization. This means every conversation is isolated — there is no shared context across sessions within a project. Users lose continuity when they start a new session: the AI has no awareness of prior conversations, decisions, or operations performed in earlier sessions on the same project.

Stream.io supports threads within channels, which map naturally to a "one memory per project, one session per thread" model. By restructuring sessions as threads inside a project memory, the system gains project-level continuity (the memory holds all sessions), cleaner session organization (sessions are lightweight and browsable within their parent memory), and a natural foundation for multi-user collaboration since Stream channels already support multiple participants.

The application domain uses its own vocabulary to avoid leaking Stream's implementation details: a **memory** is the project-level container (backed by a Stream channel) and a **session** is an individual conversation (backed by a Stream thread). This abstraction boundary keeps the codebase maintainable if the underlying messaging provider changes.

The app database currently has no record of the session-to-project relationship — Stream is the sole source of truth. Adding a thin mapping layer in the app DB (project → memory, session → memory) gives the backend authoritative knowledge of the session topology without duplicating message storage.

## What Changes

- **One memory per project** — Each project maps to a single memory, recorded in a new `project_memories` table in the app database. The memory is backed by a Stream channel. Channel ID format changes from per-session (`chat_{orgId}_{sessionHash}`) to per-project (`proj_{compactOrgId}_{compactProjectId}`).
- **Memory creation and retrieval are separate operations** — The frontend decides whether to create or fetch a memory. The backend exposes two distinct use cases: `get_project_memory` (returns an existing memory or 404) and `create_project_memory` (provisions a new Stream channel and records the mapping). The frontend calls GET first, and only calls POST if no memory exists. This maintains single responsibility on the backend.
- **Sessions become threads in the project memory** — Creating a new session creates a Stream thread within the project's memory. A new `sessions` table in the app DB maps each session to its parent memory with an `owner_id` field and an optional `display_name` for user-assigned labels.
- **Session ownership** — Every session has an `owner_id` (FK to user). The owner is the user who created the session. Ownership is immutable and used for authorization decisions (e.g., who can rename, delete, or share a session).
- **Project-level memory** — Because all sessions live in the same memory, the AI can reference prior session summaries or memory-level metadata to maintain continuity across conversations. The memory's custom data holds project-scoped context (project ID, org ID).
- **Session list queries sessions within a memory** — The SessionList component queries sessions within the active project's memory instead of querying top-level channels across the org. Session metadata (display name, owner, last activity, message count) drives the list UI.
- **Memory creation lifecycle** — Memories are created lazily on first chat within a project. The frontend checks for an existing memory (GET), and if none exists, creates one (POST). The backend enforces idempotency via a unique constraint on `project_id`.
- **Migration path** — Existing standalone session channels are migrated to sessions (threads) within their associated project's memory. Sessions without a project association are grouped under a default "unscoped" memory per org.

## Capabilities

### New Capabilities
- `project-memory-mapping`: Each project maps to exactly one memory, recorded in the app database `project_memories` table. The backend can resolve any project to its Stream channel without querying Stream.
- `project-memory-crud`: Separate `get_project_memory` and `create_project_memory` use cases. The frontend orchestrates the get-then-create flow, keeping each backend use case single-responsibility.
- `session-management`: Chat sessions are modeled as Stream threads within the project memory. The `sessions` table tracks session-to-memory relationships, owner, and optional display name.
- `session-ownership`: Every session has an immutable `owner_id`. Ownership gates write operations (rename, delete) and is the foundation for the collaboration permission model.
- `project-level-memory`: All sessions for a project share a memory, enabling the AI to access cross-session context — prior session summaries, memory metadata, and project-scoped history.
- `session-display-names`: Users can assign and edit display names on their own sessions for easier identification in the session list.

### Modified Capabilities
- `stream-chat-persistence`: Messages persist in Stream threads (not top-level channels). Write-behind from SSE streaming writes to the session's thread rather than the channel root.
- `stream-chat-display`: Chat UI renders session (thread) messages instead of channel messages. Session switching navigates between threads within the same memory.
- `session-lifecycle`: Session creation creates a thread (not a channel). Session freezing and inactivity rules apply per-session.
- `entity-context-tracking`: Entity context (active dataset/view) is tracked per-session. The parent memory holds project-level context; the session holds conversation-level context.

## Impact

### Backend
- **New**: `project_memories` table — columns: `id`, `project_id` (unique), `org_id`, `stream_channel_id`, `created_at`
- **New**: `sessions` table — columns: `id`, `memory_id` (FK to project_memories), `stream_thread_id`, `owner_id` (FK to user), `display_name` (nullable), `created_at`, `last_active_at`
- **New**: Alembic migration for both tables
- **New**: Use case `get_project_memory` — returns the memory for a project or 404
- **New**: Use case `create_project_memory` — provisions a Stream channel, records the mapping, returns the memory
- **New**: Use cases for session management: `create_session`, `list_sessions`, `update_session`
- **New**: Controller endpoints for memory retrieval/creation and session CRUD
- **Modified**: Stream token endpoint unchanged, but memory/session permissions may need scoping

### Frontend
- **Modified**: `useChatEngine` — `createChannel` becomes `createSession` (creates thread in project memory); `loadChannel` becomes `loadSession` (watches a thread within the project memory). Frontend orchestrates the get-or-create flow for memories.
- **Modified**: `channelId.ts` — ID generation changes to project-scoped format
- **Modified**: `SessionList` — queries sessions within the project memory instead of top-level org channels; displays session display names, owners, and metadata
- **Modified**: `ChatContext` — manages session state instead of channel state; session reference replaces channel reference
- **New**: Session display name editing UI (inline rename in session list, owner-only)

### Worker
- **Unchanged**: POST /chat remains stateless. Messages and context are still passed in the request body.

### Infrastructure
- **New**: Alembic migration for `project_memories` and `sessions` tables
- **Migration**: One-time script to convert existing standalone channels to sessions within their project's memory
