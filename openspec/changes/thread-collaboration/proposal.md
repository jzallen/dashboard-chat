## Why

With sessions modeled as threads in project memories (see `sessions-as-threads` change), every user's conversations live in the same Stream channel for a project. However, sessions are currently personal — only the owner can see and interact with their own sessions. There is no way to share a conversation with a teammate, let a colleague observe an analysis in progress, or hand off an in-flight session to another user.

Stream.io already supports multi-user participation in channels and threads. The infrastructure for real-time collaboration (message sync, presence, typing indicators) is built into the platform. What's missing is an application-level permission model that lets users control who can see and participate in their sessions.

By adding a permission layer on top of the sessions model, owners can grant specific users read-only observation or read-write collaboration access. This turns dashboard-chat from a single-user tool into a collaborative workspace where teams can share analytical conversations, review each other's data operations, and build on each other's work — all within the project memory they already share. Because the chat agent is behind the backend API (see `sessions-as-threads`), the backend can enforce permissions on all chat operations server-side.

## What Changes

- **Session permissions as a separate table** — A new `session_permissions` table stores per-user access grants for sessions. Each row grants a specific `grantee_id` (user) a specific access level (`read` or `readwrite`) for a session. Sessions with no rows in this table are private (owner-only). This separates the permission concern from the session entity itself, keeping the `sessions` table focused on session identity and ownership.
- **Sharing controls UI** — Session owners can grant access to specific users from the session list or within the session header. A share button or menu exposes the access level options with clear labels (e.g., "Can view", "Can edit") and a user picker for selecting grantees.
- **Shared sessions in session list** — The session list shows a "Shared with me" section listing sessions where the current user has been granted access by other users in the same project. Shared sessions display the owner's name, access level, and last activity.
- **Stream member management** — When a user is granted access to a session, the backend adds them to the Stream thread. For `readwrite` grants, Stream's built-in message permissions allow the grantee to send messages. For `read` grants, the application enforces read-only at the backend API layer (since the agent is behind the backend) and in the UI.
- **Real-time collaboration in readwrite sessions** — Multiple users can simultaneously view and send messages in a `readwrite` session. Stream handles message ordering, delivery, and real-time sync. Typing indicators and presence show who else is active in the session.
- **Permission enforcement at the backend API** — Because the chat agent is behind the backend API, the backend validates permissions on all chat operations. When a user sends a message, the backend checks whether they are the session owner or have a `readwrite` grant before forwarding to the agent. Read-only users can retrieve messages but message sends are rejected server-side. This eliminates the gap of UI-only enforcement.

## Capabilities

### New Capabilities
- `session-permissions`: A `session_permissions` table stores per-user access grants. Each row maps a `grantee_id` (user) to a `session_id` with an `access_level` (`read` or `readwrite`). Sessions with no permission rows are private to the owner. Only the session owner can create, update, or revoke grants.
- `session-sharing-controls`: Session owners can grant access to specific users via UI controls in the session list and session header. A user picker allows selecting grantees and setting their access level. Changes propagate immediately — grantees see the session appear in their "Shared with me" section in real time.
- `shared-session-browsing`: The session list includes a "Shared with me" section showing sessions where the current user has been granted access. Each entry displays the owner's name, access level badge, and last activity timestamp.
- `collaborative-sessions`: In sessions where a user has `readwrite` access, they can send messages, trigger tool calls, and see other participants' activity in real time. Stream provides message ordering, delivery guarantees, typing indicators, and presence.
- `session-permission-enforcement`: The backend enforces access rules on all session operations, including chat message sends (since the agent is behind the backend API). Private sessions are invisible and inaccessible to non-owners. Read grants allow message retrieval but reject message sends. Readwrite grants allow full participation.

### Modified Capabilities
- `session-management`: The `sessions` table is unchanged. Per-user permissions are managed entirely through the `session_permissions` table, keeping session identity and access control cleanly separated.
- `stream-chat-display`: Chat UI respects session access level — read-only sessions disable the message input for non-owners. A banner indicates the session's sharing status and lists active participants.
- `agent-behind-api`: The backend's chat proxy endpoint (from `sessions-as-threads`) gains permission checking. Before forwarding a message to the agent, the backend verifies the caller is the session owner or has a `readwrite` grant.

## Impact

### Backend
- **New**: `session_permissions` table — columns: `id`, `session_id` (FK to sessions), `grantee_id` (FK to user), `access_level` (`read`/`readwrite`), `granted_at`, unique constraint on `(session_id, grantee_id)`
- **New**: Alembic migration for the `session_permissions` table
- **New**: Use case `grant_session_access` — validates ownership, upserts a permission row for the grantee
- **New**: Use case `revoke_session_access` — validates ownership, deletes the permission row for the grantee
- **Modified**: `list_sessions` — returns sessions owned by the user plus sessions where the user has a permission grant
- **Modified**: Chat proxy endpoint — checks session ownership or `readwrite` grant before forwarding messages to the agent
- **Modified**: Session access validation — checks ownership or permission grant before allowing message retrieval or sends

### Frontend
- **New**: Share button/menu component on session list items and session header — exposes user picker and access level options (owner-only)
- **New**: "Shared with me" section in SessionList — grouped below personal sessions, showing owner name and access level badge
- **Modified**: `ChatInput` — disabled for users with `read` grants, with explanatory tooltip
- **Modified**: `MessageList` — shows a sharing banner (e.g., "Shared by Alice — view only") for non-owned sessions
- **New**: Real-time presence indicators in shared sessions (who else is viewing/typing)

### Worker
- **Unchanged**: POST /chat remains stateless. The worker does not enforce session permissions — the backend API layer handles this before forwarding requests.

### Infrastructure
- **New**: Alembic migration for `session_permissions` table
- **Stream configuration**: May configure Stream thread-level permissions as defense-in-depth, though primary enforcement is at the backend API layer
