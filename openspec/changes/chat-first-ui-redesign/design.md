## Context

The frontend currently uses a 3-panel layout (SideNav | Content | ChatPanel) where chat is a fixed 384px sidebar that activates only after a dataset is selected. Stream Chat is already integrated as the persistence layer — `StreamProvider` manages auth, `useSessionContext` creates/queries channels scoped by `projectId`, and `useChatEngine` reads/writes messages to Stream channels. However, the frontend doesn't leverage Stream's full capabilities for session management.

This design covers the frontend restructuring needed to make chat the primary interface, with Stream Chat as the sole session backend. The worker's Redis/S3 session infrastructure was already removed in the `stream-chat-integration` change; remaining dead code (`worker/lib/s3.ts`, `ChatClient` session methods, broken `SessionViewer`/`SessionList`) is cleaned up here.

## Goals / Non-Goals

**Goals:**
- Replace the 3-panel layout with 2-panel (SideNav | Content)
- Make ChatView the landing page at `/`
- Decouple chat from dataset selection — chat works without a dataset
- Add inline chat input to TableView with activity log overlay
- Add unified navigation with recent sessions powered by Stream `queryChannels`
- Enable session title management via Stream channel custom data
- Remap Stream channels from project-scoped to org-scoped
- Clean up dead session infrastructure code

**Non-Goals:**
- Worker or backend changes (beyond dead code removal in worker)
- AI-generated session titles (future)
- Session search or pinning (future)
- Keyboard shortcuts (future)
- Mobile/responsive layout
- Migrating existing project-scoped channels to new format

## Decisions

### D1: ChatView extracts from ChatPanel, not a wrapper around it

**Decision:** Create a new `ChatView` component that reuses message rendering components (MessageBubble, ChatEmptyState) but has its own layout — full-width with expanding textarea. Do NOT wrap the existing ChatPanel inside ChatView.

**Rationale:**
- ChatPanel is a fixed-width sidebar component (w-96) with tightly coupled layout assumptions (border-left, compact header)
- ChatView needs fundamentally different layout: full-width, centered content column, larger input area, suggestion chips
- Extracting shared pieces (MessageBubble, message list rendering) into a shared module is cleaner than forcing ChatPanel to be responsive to two different contexts
- The inline chat input in TableView is also different from ChatPanel — it's a slim bar, not a panel

**What's shared:** `MessageBubble`, `ChatEmptyState` (modified for suggestion chips), message type definitions, streaming indicator. Extract these into `frontend/src/ui/components/chat/` as shared modules.

### D2: Stream channel created eagerly on ChatView mount

**Decision:** When ChatView mounts at `/`, immediately create a Stream channel via `client.channel("messaging", channelId, customData).watch()` and replace the URL to `/chat/:channelId`. This makes every chat interaction have a stable channel ID from the start.

**Rationale:**
- Eager creation means the session URL is immediately shareable/bookmarkable
- Stream channel creation is lightweight — no server-side persistence until the first message is sent (Stream uses lazy persistence for empty channels)
- URL replace (not push) means the back button still works correctly
- The `stream-chat-integration` change already uses eager channel creation in `useSessionContext` — this extends the same pattern

**Channel ID format:** `chat_{compactOrgId}_{8charHash}` — org-scoped, not project-scoped. `compactOrgId` is a base-36 truncation of the org ID and `8charHash` is an 8-character hex hash derived from `(orgId, userId)`. This compact format stays under Stream Chat's 64-character channel ID limit. (Originally specified as `chat_{orgId}_{uuid}` with `crypto.randomUUID()`; changed in commit a339b62.)

**Channel custom data on creation:**
```typescript
{
  orgId: string,       // required — used for queryChannels filter
  projectId: null,     // set later if dataset is selected
  datasetId: null,     // set later via picker or TableView navigation
  title: null,         // auto-set from first message
  createdAt: new Date().toISOString(),
}
```

### D3: useChatEngine refactored to own Stream channel lifecycle

**Decision:** Refactor `useChatEngine` to manage the Stream channel directly as its primary state, removing the external `registerCurrentChannel()` pattern. The hook manages a state machine with three states: `idle`, `active`, `loaded`.

**Rationale:**
- Current `registerCurrentChannel()` is a ref set by external callers — the engine doesn't own its own session
- The new model makes the engine the single owner of the channel lifecycle
- `isActive` (tied to tool handler registration) is removed — chat input is always enabled when a channel exists
- Stream channel is the source of truth for session identity, message history, and metadata

**State transitions:**
```
idle → active:  channel.watch() succeeds (ChatView mount, new session)
idle → loaded:  channel.watch() succeeds (resume from /chat/:channelId)
active → idle:  "New Session" clicked (clear channel reference)
loaded → idle:  "New Session" clicked (clear channel reference)
```

**What changes in useChatEngine:**
- `currentChannelRef` → `channel` (useState — drives re-renders for URL updates, nav refresh)
- `isActive` removed — chat input always enabled when `channel !== null`
- `handleSubmit` no longer gates on `toolHandler` — sends without schema if no handler
- Tool call results checked against `toolHandlerRef` — if null, show "navigate to table" prompt
- `registerCurrentChannel()` removed — replaced by `createChannel(orgId)` and `loadChannel(channelId)` methods
- `buildApiMessages()` unchanged — already reads from `channel.state.messages`
- `writeToStream()` unchanged — already writes to current channel

### D4: Unified nav replaces conditional OrgNav/ProjectNav

**Decision:** Replace the conditional rendering of OrgNav/ProjectNav with a single `UnifiedNav` component that always shows: New Session, Projects, Chats, Recent Sessions.

**Rationale:**
- The current conditional nav is tied to the old routing model where AppShell derives projectId from URL params
- The new routes don't nest under `/projects/:projectId` uniformly
- A unified nav provides consistent navigation regardless of current route
- Project/dataset browsing moves to the content area (ProjectGrid, DatasetGrid components)

**What happens to ProjectNav/OrgNav:** Deprecated. Their content moves to dedicated route components.

### D5: Recent sessions powered by Stream queryChannels

**Decision:** Use Stream's `queryChannels` API for the recent sessions list and session list page, not custom REST hooks.

**Rationale:**
- Stream already provides channel listing with sorting, filtering, and pagination
- Real-time updates via WebSocket — new messages automatically reorder the list without manual query invalidation
- No custom backend endpoints needed
- `stream-chat-react` provides a `ChannelList` component, but we'll use a custom list for tighter control over the nav UI

**Query for recent sessions (nav):**
```typescript
client.queryChannels(
  { type: "messaging", "custom.orgId": orgId },
  { last_message_at: -1 },
  { limit: 5, watch: true }  // watch: true enables real-time updates
);
```

**Query for session list page:**
```typescript
client.queryChannels(
  { type: "messaging", "custom.orgId": orgId },
  { last_message_at: -1 },
  { limit: 30, offset }  // paginated
);
```

### D6: TableView inline chat shares channel, not a new engine

**Decision:** TableView's inline chat input connects to the same ChatContext channel that ChatView uses. Same `useChatEngine` instance — just a different input UI.

**Rationale:**
- A separate engine for TableView would create disconnected sessions
- Sharing the engine means navigating from ChatView to TableView preserves conversation context
- The activity log overlay reads from the shared message array
- All messages are in one continuous Stream channel

**Implementation:** TableView renders its own input bar and activity log, but calls the same `handleSubmit` and reads the same `messages` from `useChatContext()`. DatasetDetail registers `toolHandler` and `tableSchema` on mount.

### D7: Dataset context picker is a chat message component, not a modal

**Decision:** When a table operation is issued without dataset context, render an inline dataset picker as a special message in the chat history.

**Rationale:**
- Keeps the user in the chat flow
- The picker becomes part of the conversation history
- Consistent with modern chat UI patterns (inline interactive elements)

**Implementation:** A new message type `widget: { type: "dataset-picker" }` triggers rendering a `DatasetPicker` component inline. On selection, it calls `channel.updatePartial({ set: { datasetId } })` and re-submits the original command.

### D8: /table/:datasetId derives projectId from dataset API response

**Decision:** The `/table/:datasetId` route omits projectId from the URL. TableView fetches the dataset, which includes `project_id`.

**Rationale:**
- Shorter, cleaner URLs
- The dataset→project relationship is already in the API response
- Trade-off: deep-linking doesn't reveal the project from the URL alone. Acceptable — the UI shows it.

### D9: Old project-scoped channels are not migrated

**Decision:** Existing `project_{pid}_{uuid}` channels are left as-is. The new nav only queries `chat_{compactOrgId}_{8charHash}` channels. Old channels are effectively archived — accessible if you know the channel ID, but not listed in the new UI.

**Rationale:**
- Migration adds complexity for marginal benefit (existing sessions have limited history)
- Stream channels don't expire by default — they remain accessible indefinitely
- If needed later, a one-time script can backfill `orgId` into old channels

## Architecture

### Component Tree (new)

```
<BrowserRouter>
  <AuthProvider>
    <StreamProvider>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/callback" element={<AuthCallback />} />

        {/* Protected */}
        <Route element={<RequireAuth><RequireOrg><ChatProvider><AppShell /></ChatProvider></RequireOrg></RequireAuth>}>
          <Route index element={<ChatView />} />
          <Route path="chat/:channelId" element={<ChatView />} />
          <Route path="projects" element={<ProjectGrid />} />
          <Route path="projects/:projectId" element={<DatasetGrid />} />
          <Route path="table/:datasetId" element={<TableView />} />
          <Route path="sessions" element={<SessionList />} />
        </Route>
      </Routes>
    </StreamProvider>
  </AuthProvider>
</BrowserRouter>
```

### AppShell Layout (new)

```
┌─────────────────────────────────────────────────┐
│ ┌──────────┐ ┌────────────────────────────────┐ │
│ │ SideNav  │ │                                │ │
│ │          │ │  <Outlet />                    │ │
│ │ + New    │ │  (ChatView | TableView |       │ │
│ │ Projects │ │   ProjectGrid | DatasetGrid |  │ │
│ │ Chats    │ │   SessionList)                 │ │
│ │ ──────── │ │                                │ │
│ │ Recent:  │ │                                │ │
│ │  sess 1  │ │                                │ │
│ │  sess 2  │ │                                │ │
│ │  sess 3  │ │                                │ │
│ └──────────┘ └────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

### ChatContext State Flow (new)

```
                    ┌─────────────┐
                    │    idle      │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │ mount at /  │ mount at   │
              │             │ /chat/:id  │
              ▼             │            ▼
     client.channel()       │     client.channel(id)
     .watch()               │     .watch()
              │             │            │
              ▼             │            ▼
        ┌─────────┐        │     ┌──────────┐
        │ active   │        │     │  loaded   │
        └────┬────┘        │     └─────┬─────┘
             │             │           │
             │  "New Session" clicked  │
             └────────────►┤◄──────────┘
                           │
                    ┌──────┴──────┐
                    │    idle      │
                    └─────────────┘
```

### Stream Channel Data Model

```
Channel {
  id:     "chat_{compactOrgId}_{8charHash}"
  type:   "messaging"
  data: {
    orgId:      string       // required — query filter
    projectId:  string|null  // set when dataset selected
    datasetId:  string|null  // set via picker or TableView
    title:      string|null  // auto-set from first message
    createdAt:  string       // ISO timestamp
  }
  state: {
    messages:       Message[]    // full history
    last_message_at: string     // for sort ordering
  }
}
```

### Shared Chat Components

```
frontend/src/ui/components/chat/
  MessageBubble.tsx          # Extracted from ChatPanel (user/assistant bubbles)
  MessageList.tsx            # Scrollable message container with auto-scroll
  ChatInput.tsx              # Expanding textarea + gutter (shared by ChatView + TableView)
  WelcomeState.tsx           # Greeting + suggestion chips (ChatView only)
  ActivityLog.tsx            # (lives in TableView/ — only used there; not shared)
  DatasetPicker.tsx          # Inline dataset/project selector
  SessionItem.tsx            # Nav item for recent sessions
```

### Data Flow: Message Send

```
User types in ChatView (or TableView inline input)
  ↓
submitText() — no gating on toolHandler
  ↓
writeToStream() → channel.sendMessage({ text })     [user msg persisted in Stream]
  ↓
chatClient.fetchChatStream(apiMessages, tableSchema) → POST /chat to worker
  ↓
Worker: GroqChatClient.streamCompletion() → Groq API (SSE streaming)
  ↓
readSSEStream() → onContent() updates UI overlay
  ↓
onDone(content, toolCalls):
  ├─ toolHandler exists? → executeToolCalls() → apply to table
  └─ toolHandler null?   → show "navigate to table" prompt
  ↓
writeToStream() → channel.sendMessage({ text, custom: { tool_calls } })  [assistant msg persisted]
  ↓
Stream WebSocket → nav recent sessions list auto-updates
```

## Migration

This is a frontend-only change with no data migration. The approach:

1. **Phase 0 — Dead Code Cleanup**: Remove broken/dead code (`worker/lib/s3.ts`, ChatClient session methods, SessionViewer, SessionList). Clean foundation.
2. **Phase 1 — Foundation**: Refactor AppShell layout (remove ChatPanelConnected), update routes, extract shared chat components.
3. **Phase 2 — Stream Session Refactor**: Remap `useSessionContext` from project-scoped to org-scoped. Refactor `useChatEngine` to own channel lifecycle. Remove `isActive` gating.
4. **Phase 3 — New Views**: Build ChatView, TableView, UnifiedNav (with Stream-backed recent sessions), SessionList (with Stream-backed channel query).
5. **Phase 4 — Polish**: Session titles, dataset picker, activity log, navigation state preservation, test fixes.

No feature flags needed — all changes land together on the feature branch. Old project-scoped channels are left as-is (D9).
