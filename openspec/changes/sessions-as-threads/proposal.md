## Why

Each chat session currently creates its own Stream channel, scoped to the organization. This means every conversation is isolated — there is no shared context across sessions within a project. Users lose continuity when they start a new session: the AI has no awareness of prior conversations, decisions, or operations performed in earlier sessions on the same project.

Stream.io supports threads within channels, which map naturally to a "one memory per project, one session per thread" model. By restructuring sessions as threads inside a project memory, the system gains project-level continuity (the memory holds all sessions), cleaner session organization (sessions are lightweight and browsable within their parent memory), and a natural foundation for multi-user collaboration since Stream channels already support multiple participants.

The application domain uses its own vocabulary to avoid leaking Stream's implementation details: a **memory** is the project-level container (backed by a Stream channel) and a **session** is an individual conversation (backed by a Stream thread). This abstraction boundary keeps the codebase maintainable if the underlying messaging provider changes.

The app database currently has no record of the session-to-project relationship — Stream is the sole source of truth. Adding a thin mapping layer in the app DB (project → memory, session → memory) gives the backend authoritative knowledge of the session topology without duplicating message storage.

## What Changes

- **One memory per project, created via outbox on project creation** — Every new project automatically triggers memory creation through the outbox event system. A `project_created` event provisions a Stream channel and records the mapping in a new `project_memories` table. This ensures every project always has a memory — no lazy creation, no race conditions, no partial states. Channel ID format changes from per-session (`chat_{compactOrgId}_{sessionHash}`) to per-project (`proj_{compactOrgId}_{compactProjectId}`), using `compactId` for both components.
- **Memory retrieval is a simple GET** — The backend exposes a single `get_project_memory` use case. Since memory creation is handled by the outbox event on project creation, the frontend never needs to create a memory. It fetches the memory for the selected project and proceeds to session management.
- **Project selection as entry point** — Users must select a project before chatting, similar to selecting a git repository in Claude Code. The project picker is the first interaction point. Once a project is selected, the frontend resolves its memory and displays the session list.
- **Sessions become threads in the project memory** — Creating a new session creates a Stream thread within the project's memory. A new `sessions` table in the app DB maps each session to its parent memory with an `owner_id` field. Session titles are automatically set from the first message content, defined by the session owner.
- **Session ownership** — Every session has an `owner_id` (FK to user). The owner is the user who created the session. Ownership is immutable and used for authorization decisions (e.g., who can rename, delete, or share a session).
- **Multiple active sessions** — Sessions have no expiration or freezing. Users can maintain multiple active sessions within a project and revisit any session at any time. Sessions persist indefinitely.
- **Project-level memory** — Because all sessions live in the same memory, the AI can reference prior session summaries or memory-level metadata to maintain continuity across conversations. The memory's custom data holds project-scoped context (project ID, org ID). Memory is managed behind the scenes — no user-facing display name or direct memory interaction.
- **Session list queries sessions within a memory** — The SessionList component queries sessions within the active project's memory instead of querying top-level channels across the org. Session metadata (title, owner, last activity, message count) drives the list UI.
- **Chat agent behind the backend API** — The chat agent (worker) moves behind the backend API as internal-only traffic. The frontend sends messages to the backend, which forwards them to the agent. This allows the agent to remain stateless while being protected from arbitrary external requests. When deployed to cloud resources, the agent accepts messages only from the backend API.
- **Dataset resolution in chat** — The chat agent gains the ability to find datasets by name or present a dataset picker when the user references a dataset in conversation. If a dataset is resolved, the prompt is reprocessed with the dataset's schema as context, enabling the agent to operate on the correct data without requiring the user to manually select a dataset first.

## Capabilities

### New Capabilities
- `project-memory-mapping`: Each project maps to exactly one memory, recorded in the app database `project_memories` table. Memory is created automatically via outbox event when a project is created. The backend can resolve any project to its Stream channel without querying Stream.
- `project-memory-outbox`: A `project_created` outbox event triggers Stream channel provisioning and `project_memories` row creation. This guarantees every project has a memory from the moment it exists.
- `session-management`: Chat sessions are modeled as Stream threads within the project memory. The `sessions` table tracks session-to-memory relationships and owner. Session titles are set from the first message content.
- `session-ownership`: Every session has an immutable `owner_id`. Ownership gates write operations (rename, delete) and is the foundation for the collaboration permission model.
- `project-level-memory`: All sessions for a project share a memory, enabling the AI to access cross-session context — prior session summaries, memory metadata, and project-scoped history.
- `project-selection`: Users select a project as the first step before chatting. The project picker is the entry point to the chat experience.
- `agent-behind-api`: The chat agent is accessed exclusively through the backend API. The frontend sends chat requests to the backend, which proxies them to the agent. The agent is not directly accessible from the public internet.
- `dataset-resolution`: The chat agent can resolve dataset references by name. When a user mentions a dataset, the agent looks it up or presents a picker. If found, the prompt is reprocessed with the dataset's schema injected as context.

### Modified Capabilities
- `stream-chat-persistence`: Messages persist in Stream threads (not top-level channels). Write-behind from SSE streaming writes to the session's thread rather than the channel root.
- `stream-chat-display`: Chat UI renders session (thread) messages instead of channel messages. Session switching navigates between threads within the same memory.
- `entity-context-tracking`: Entity context (active dataset/view) is tracked per-session. The parent memory holds project-level context; the session holds conversation-level context. Dataset context can be set explicitly by the user or resolved by the agent from natural language references.

### Removed Capabilities
- `session-lifecycle`: Session freezing and inactivity rules are removed. Sessions persist indefinitely and can be revisited at any time. Multiple sessions can be active simultaneously within a project.

## Impact

### Backend
- **New**: `project_memories` table — columns: `id`, `project_id` (unique), `org_id`, `stream_channel_id`, `created_at`
- **New**: `sessions` table — columns: `id`, `memory_id` (FK to project_memories), `stream_thread_id`, `owner_id` (FK to user), `title` (nullable, set from first message), `created_at`, `last_active_at`
- **New**: Alembic migration for both tables
- **New**: Outbox event handler for `project_created` — provisions Stream channel, inserts `project_memories` row
- **New**: Use case `get_project_memory` — returns the memory for a project
- **New**: Use cases for session management: `create_session`, `list_sessions`, `update_session`
- **New**: Chat proxy endpoint — receives chat requests from frontend, forwards to agent with auth context
- **New**: Controller endpoints for memory retrieval and session CRUD
- **Modified**: Stream token endpoint unchanged, but memory/session permissions may need scoping

### Frontend
- **New**: Project selection as entry point — project picker must be completed before accessing chat
- **Modified**: `useChatEngine` — `createChannel` becomes `createSession` (creates thread in project memory); `loadChannel` becomes `loadSession` (watches a thread within the project memory). Memory is fetched via GET, never created by the frontend.
- **Modified**: `channelId.ts` — ID generation changes to project-scoped format using `compactId` for both org and project components
- **Modified**: `SessionList` — queries sessions within the project memory instead of top-level org channels; displays session titles, owners, and metadata
- **Modified**: `ChatContext` — manages session state instead of channel state; session reference replaces channel reference. Chat requests route through backend API instead of directly to worker.
- **Deleted**: Session freezing UI and related logic

### Worker
- **Modified**: No longer publicly accessible. Receives chat requests only from the backend API as internal traffic.
- **New**: Dataset resolution — agent can look up datasets by name and reprocess prompts with schema context
- **Unchanged**: Core chat handler remains stateless. Messages and context are still passed in the request body.

### Infrastructure
- **New**: Alembic migration for `project_memories` and `sessions` tables
- **Modified**: Network configuration — worker service moves to internal-only networking, accessible only from backend
