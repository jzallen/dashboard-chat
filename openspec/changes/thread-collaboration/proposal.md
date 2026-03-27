## Why

With sessions modeled as threads in project memories (see `sessions-as-threads` change), every user's conversations live in the same Stream channel for a project. However, sessions are currently personal — only the owner can see and interact with their own sessions. There is no way to share a conversation with a teammate, let a colleague observe an analysis in progress, or hand off an in-flight session to another user.

Stream.io already supports multi-user participation in channels and threads. The infrastructure for real-time collaboration (message sync, presence, typing indicators) is built into the platform. What's missing is an application-level permission model that lets users control who can see and participate in their sessions.

By adding a visibility/permission layer on top of the sessions model, owners can make personal sessions accessible for read-only observation or read-write collaboration. This turns dashboard-chat from a single-user tool into a collaborative workspace where teams can share analytical conversations, review each other's data operations, and build on each other's work — all within the project memory they already share.

## What Changes

- **Session visibility as a separate table** — A new `session_permissions` table stores non-owner permissions for sessions. Each row grants a specific access level (`read` or `readwrite`) for a session. Sessions with no rows in this table are private (owner-only). This separates the permission concern from the session entity itself, keeping the `sessions` table focused on session identity and ownership.
- **Sharing controls UI** — Session owners can change visibility from the session list or within the session header. A share button or menu exposes the visibility options with clear labels (e.g., "Only me", "Others can view", "Others can edit").
- **Shared sessions in session list** — The session list shows a "Shared with me" section listing sessions made accessible by other users in the same project. Shared sessions display the owner's name, access level, and last activity.
- **Stream member management** — When a session is shared, the backend manages Stream thread membership accordingly. For `readwrite` sessions, Stream's built-in message permissions allow all members to send messages. For `read` sessions, the application enforces read-only in the UI and optionally via Stream thread-level permissions.
- **Real-time collaboration in readwrite sessions** — Multiple users can simultaneously view and send messages in a `readwrite` session. Stream handles message ordering, delivery, and real-time sync. Typing indicators and presence show who else is active in the session.
- **Permission enforcement** — The backend validates access permissions on session operations. Users cannot load or query sessions they don't have permission to see. The `session_permissions` table is the authoritative source for non-owner access. The frontend hides sessions that have no visibility grant for the current user.

## Capabilities

### New Capabilities
- `session-visibility`: A `session_permissions` table stores non-owner access grants per session. Access levels are `read` (can view messages but not send) and `readwrite` (full participation). Sessions with no visibility rows are private to the owner. Only the session owner can create, update, or revoke visibility grants.
- `session-sharing-controls`: Session owners can manage visibility via UI controls in the session list and session header. Changes propagate immediately — other users see the session appear in their "Shared with me" section in real time.
- `shared-session-browsing`: The session list includes a "Shared with me" section showing sessions with visibility grants for the current user. Each entry displays the owner's name, access level badge, and last activity timestamp.
- `collaborative-sessions`: In `readwrite` sessions, multiple users can send messages, trigger tool calls, and see each other's activity in real time. Stream provides message ordering, delivery guarantees, typing indicators, and presence.
- `session-permission-enforcement`: The backend enforces access rules on session operations. Private sessions (no visibility rows) are invisible and inaccessible to non-owners. Read sessions allow message retrieval but reject message sends from non-owners. Readwrite sessions allow full participation.

### Modified Capabilities
- `session-management`: The `sessions` table is unchanged. Non-owner permissions are managed entirely through the `session_permissions` table, keeping session identity and access control cleanly separated.
- `stream-chat-display`: Chat UI respects session access level — read-only sessions disable the message input for non-owners. A banner indicates the session's sharing status.
- `session-lifecycle`: Session freezing interacts with visibility — frozen sessions remain visible to shared users but are read-only for everyone, including the owner.

## Impact

### Backend
- **New**: `session_permissions` table — columns: `id`, `session_id` (FK to sessions), `access_level` (`read`/`readwrite`), `granted_at`, unique constraint on `session_id` (one visibility level per session for the org)
- **New**: Alembic migration for the `session_permissions` table
- **New**: Use case `update_session_permissions` — validates ownership, upserts or deletes the visibility row
- **New**: Use case `list_shared_sessions` — returns sessions with visibility grants for the requesting user within a project
- **Modified**: `list_sessions` — returns sessions owned by the user plus sessions with visibility grants
- **Modified**: Session access validation — checks ownership or visibility grant before allowing message retrieval or sends
- **New**: Permission enforcement middleware or guard for session endpoints

### Frontend
- **New**: Share button/menu component on session list items and session header — exposes visibility options (owner-only)
- **New**: "Shared with me" section in SessionList — grouped below personal sessions, showing owner name and access level badge
- **Modified**: `ChatInput` — disabled for non-owners in `read` sessions with explanatory tooltip
- **Modified**: `MessageList` — shows a sharing banner (e.g., "Shared by Alice — view only") for non-owned sessions
- **New**: Real-time presence indicators in shared sessions (who else is viewing/typing)

### Worker
- **Unchanged**: POST /chat remains stateless. The worker does not enforce session permissions — that is handled by the backend and frontend.

### Infrastructure
- **New**: Alembic migration for `session_permissions` table
- **Stream configuration**: May need to configure Stream thread-level permissions to enforce read-only for `read` sessions at the platform level (defense in depth beyond UI enforcement)
