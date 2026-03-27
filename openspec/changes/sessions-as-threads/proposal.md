## Why

Each chat session currently creates its own Stream channel, scoped to the organization. This means every conversation is isolated — there is no shared context across sessions within a project. Users lose continuity when they start a new session: the AI has no awareness of prior conversations, decisions, or operations performed in earlier sessions on the same project.

Stream.io supports threads within channels, which map naturally to a "one channel per project, one thread per session" model. By restructuring sessions as threads inside a project channel, the system gains project-level memory (the channel holds all threads), cleaner session organization (threads are lightweight and browsable within their parent channel), and a natural foundation for multi-user collaboration since Stream channels already support multiple participants.

The app database currently has no record of the session-to-project relationship — Stream is the sole source of truth. Adding a thin mapping layer in the app DB (project → channel, thread → channel) gives the backend authoritative knowledge of the session topology without duplicating message storage.

## What Changes

- **One Stream channel per project** — When a project is created or first chatted in, a single Stream channel is created and recorded in a new `project_channels` table in the app database. All subsequent sessions for that project use this channel. Channel ID format changes from per-session (`chat_{orgId}_{sessionHash}`) to per-project (`proj_{compactOrgId}_{compactProjectId}`).
- **Sessions become threads in the project channel** — Creating a new session creates a Stream thread within the project's channel. A new `threads` table in the app DB maps each thread to its parent channel with an optional `display_name` field for user-assigned labels.
- **Project-level memory** — Because all threads live in the same channel, the AI can reference prior thread summaries or channel-level metadata to maintain continuity across sessions. The channel's custom data holds project-scoped context (project ID, org ID).
- **Session list becomes thread list** — The SessionList component queries threads within the active project's channel instead of querying top-level channels across the org. Thread metadata (display name, last activity, message count) drives the list UI.
- **Channel creation lifecycle** — Channels are created lazily on first chat within a project. The backend records the mapping and ensures idempotency (one channel per project, enforced by unique constraint).
- **Migration path** — Existing standalone session channels are migrated to threads within their associated project's channel. Sessions without a project association are grouped under a default "unscoped" channel per org.

## Capabilities

### New Capabilities
- `project-channel-mapping`: Each project maps to exactly one Stream channel, recorded in the app database `project_channels` table. The backend can resolve any project to its channel without querying Stream.
- `session-threads`: Chat sessions are modeled as Stream threads within the project channel. The `threads` table tracks thread-to-channel relationships and stores an optional `display_name` for user labeling.
- `project-level-memory`: All sessions for a project share a channel, enabling the AI to access cross-session context — prior thread summaries, channel metadata, and project-scoped history.
- `thread-display-names`: Users can assign and edit display names on threads for easier identification in the session list.

### Modified Capabilities
- `stream-chat-persistence`: Messages persist in Stream threads (not top-level channels). Write-behind from SSE streaming writes to the thread rather than the channel root.
- `stream-chat-display`: Chat UI renders thread messages instead of channel messages. Session switching navigates between threads within the same channel.
- `session-lifecycle`: Session creation creates a thread (not a channel). Session freezing and inactivity rules apply per-thread.
- `entity-context-tracking`: Entity context (active dataset/view) is tracked per-thread. The parent channel holds project-level context; the thread holds session-level context.

## Impact

### Backend
- **New**: `project_channels` table — columns: `id`, `project_id` (unique), `org_id`, `stream_channel_id`, `created_at`
- **New**: `threads` table — columns: `id`, `channel_id` (FK to project_channels), `stream_thread_id`, `user_id`, `display_name` (nullable), `created_at`, `last_active_at`
- **New**: Alembic migration for both tables
- **New**: Use cases for channel resolution (`get_or_create_project_channel`) and thread management (`create_thread`, `list_threads`, `update_thread`)
- **New**: Controller endpoints for thread CRUD
- **Modified**: Stream token endpoint unchanged, but channel/thread permissions may need scoping

### Frontend
- **Modified**: `useChatEngine` — `createChannel` becomes `createThread` (creates thread in project channel); `loadChannel` becomes `loadThread` (watches a thread within the project channel)
- **Modified**: `channelId.ts` — ID generation changes to project-scoped format
- **Modified**: `SessionList` — queries threads within the project channel instead of top-level org channels; displays thread display names and metadata
- **Modified**: `ChatContext` — manages thread state instead of channel state; thread reference replaces channel reference
- **New**: Thread display name editing UI (inline rename in session list)

### Worker
- **Unchanged**: POST /chat remains stateless. Messages and context are still passed in the request body.

### Infrastructure
- **New**: Alembic migration for `project_channels` and `threads` tables
- **Migration**: One-time script to convert existing standalone channels to threads under their project's channel
