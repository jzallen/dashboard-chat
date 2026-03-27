## Why

With sessions modeled as threads in project channels (see `sessions-as-threads` change), every user's conversations live in the same Stream channel for a project. However, threads are currently personal — only the creator can see and interact with their own threads. There is no way to share a conversation with a teammate, let a colleague observe an analysis in progress, or hand off an in-flight session to another user.

Stream.io already supports multi-user participation in channels and threads. The infrastructure for real-time collaboration (message sync, presence, typing indicators) is built into the platform. What's missing is an application-level permission model that lets users control who can see and participate in their threads.

By adding a visibility/permission layer on top of the threads model, users can make personal threads public for read-only observation or read-write collaboration. This turns dashboard-chat from a single-user tool into a collaborative workspace where teams can share analytical conversations, review each other's data operations, and build on each other's work — all within the project channel they already share.

## What Changes

- **Thread visibility model** — Each thread has a `visibility` field: `private` (default, creator-only), `read` (visible to all org members in the project, but only the creator can send messages), or `readwrite` (any org member in the project can view and send messages). Visibility is stored in the `threads` table.
- **Sharing controls UI** — Thread owners can change visibility from the session list or within the thread header. A share button or menu exposes the three visibility options with clear labels (e.g., "Only me", "Others can view", "Others can edit").
- **Shared threads in session list** — The session list shows a "Shared with me" section listing threads made public by other users in the same project. Shared threads display the owner's name, visibility level, and last activity.
- **Stream member management** — When a thread is made `read` or `readwrite`, the backend adds project members to the Stream thread (or relies on channel-level membership since all project users share the channel). For `readwrite` threads, Stream's built-in message permissions allow all members to send messages. For `read` threads, the application enforces read-only in the UI and optionally via Stream channel-level permissions or message-send restrictions.
- **Real-time collaboration in readwrite threads** — Multiple users can simultaneously view and send messages in a `readwrite` thread. Stream handles message ordering, delivery, and real-time sync. Typing indicators and presence show who else is active in the thread.
- **Permission enforcement** — The backend validates visibility permissions on thread access. Users cannot load or query threads they don't have permission to see. The frontend hides threads that are `private` and owned by other users.

## Capabilities

### New Capabilities
- `thread-visibility`: Threads have a `visibility` field (`private`, `read`, `readwrite`) stored in the `threads` table. Default is `private`. Only the thread owner can change visibility.
- `thread-sharing-controls`: Thread owners can change visibility via UI controls in the session list and thread header. Changes propagate immediately — other users see the thread appear in their "Shared with me" section in real time.
- `shared-thread-browsing`: The session list includes a "Shared with me" section showing threads made visible by other project members. Each entry displays the owner's name, visibility badge, and last activity timestamp.
- `collaborative-threads`: In `readwrite` threads, multiple users can send messages, trigger tool calls, and see each other's activity in real time. Stream provides message ordering, delivery guarantees, typing indicators, and presence.
- `thread-permission-enforcement`: The backend enforces visibility rules on thread access. Private threads are invisible and inaccessible to non-owners. Read threads allow message retrieval but reject message sends from non-owners. Readwrite threads allow full participation.

### Modified Capabilities
- `session-threads`: The `threads` table gains a `visibility` column (default `private`) and a `shared_at` timestamp (nullable, set when visibility changes from `private`).
- `stream-chat-display`: Chat UI respects thread visibility — read-only threads disable the message input for non-owners. A banner indicates the thread's sharing status.
- `session-lifecycle`: Thread freezing interacts with visibility — frozen threads remain visible to shared users but are read-only for everyone, including the owner.

## Impact

### Backend
- **Modified**: `threads` table — add `visibility` column (`private`/`read`/`readwrite`, default `private`) and `shared_at` timestamp (nullable)
- **New**: Alembic migration for the visibility column
- **New**: Use case `update_thread_visibility` — validates ownership, updates visibility, optionally adjusts Stream thread/channel permissions
- **New**: Use case `list_shared_threads` — returns threads visible to the requesting user within a project (visibility `read` or `readwrite`, owned by other users)
- **Modified**: `list_threads` — filters to threads owned by the user plus threads shared with them
- **Modified**: Thread access validation — checks visibility before allowing message retrieval or sends
- **New**: Permission enforcement middleware or guard for thread endpoints

### Frontend
- **New**: Share button/menu component on thread list items and thread header — exposes visibility options
- **New**: "Shared with me" section in SessionList — grouped below personal threads, showing owner name and visibility badge
- **Modified**: `ChatInput` — disabled for non-owners in `read` threads with explanatory tooltip
- **Modified**: `MessageList` — shows a sharing banner (e.g., "Shared by Alice — view only") for non-owned threads
- **New**: Real-time presence indicators in shared threads (who else is viewing/typing)

### Worker
- **Unchanged**: POST /chat remains stateless. The worker does not enforce thread permissions — that is handled by the backend and frontend.

### Infrastructure
- **New**: Alembic migration adding `visibility` and `shared_at` columns to `threads`
- **Stream configuration**: May need to configure Stream channel/thread-level permissions to enforce read-only for `read` threads at the platform level (defense in depth beyond UI enforcement)
