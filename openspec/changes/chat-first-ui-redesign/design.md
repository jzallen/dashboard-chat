## Context

The frontend currently uses a 3-panel layout (SideNav | Content | ChatPanel) where chat is a fixed 384px sidebar that activates only after a dataset is selected. The ChatContext (useChatEngine) manages chat state via refs and lazy session creation. The worker session API already supports org-scoped sessions with optional dataset/project context. This design covers the frontend restructuring needed to make chat the primary interface.

## Goals / Non-Goals

**Goals:**
- Replace the 3-panel layout with 2-panel (SideNav | Content)
- Make ChatView the landing page at `/`
- Decouple chat from dataset selection — chat works without a dataset
- Add inline chat input to TableView with activity log overlay
- Add unified navigation with recent sessions
- Enable session title management (auto-set + editable)

**Non-Goals:**
- Worker or backend changes (session API is already sufficient)
- AI-generated session titles (future)
- Session search or pinning (future)
- Keyboard shortcuts (future)
- Mobile/responsive layout

## Decisions

### D1: ChatView extracts from ChatPanel, not a wrapper around it

**Decision:** Create a new `ChatView` component that reuses message rendering components (MessageBubble, ChatEmptyState) but has its own layout — full-width with expanding textarea. Do NOT wrap the existing ChatPanel inside ChatView.

**Rationale:**
- ChatPanel is a fixed-width sidebar component (w-96) with tightly coupled layout assumptions (border-left, compact header)
- ChatView needs fundamentally different layout: full-width, centered content column, larger input area, suggestion chips
- Extracting shared pieces (MessageBubble, message list rendering) into a shared module is cleaner than forcing ChatPanel to be responsive to two different contexts
- The inline chat input in TableView is also different from ChatPanel — it's a slim bar, not a panel

**What's shared:** `MessageBubble`, `ChatEmptyState` (modified for suggestion chips), message type definitions, streaming indicator. Extract these into `frontend/src/ui/components/chat/` as shared modules.

### D2: Session created eagerly on ChatView mount, URL updated via replace

**Decision:** When ChatView mounts at `/`, immediately create a session via `POST /sessions` and replace the URL to `/chat/:sessionId`. This makes every chat interaction have a stable session ID from the start.

**Rationale:**
- Current lazy creation (on first message) means the session doesn't exist until a message is sent, making it impossible to share a session URL before chatting
- Eager creation with URL replace means the back button still works (no extra history entry) and bookmarking works immediately
- The worker already handles empty sessions gracefully — the flusher skips sessions with no turns
- Cost: one extra API call per ChatView mount. Acceptable because session creation is a Redis HSET + ZADD (sub-millisecond)

**Alternative rejected:** Create session on first message (current pattern). Simpler but breaks URL-based session resume and makes recent sessions list inconsistent.

### D3: ChatContext refactored to session-centric state machine

**Decision:** Refactor `useChatEngine` to manage a session state machine with three states: `idle` (no session), `active` (session created, accepting messages), `loaded` (resumed session with history). Remove the `isActive` boolean tied to tool handler registration.

**Rationale:**
- Current `isActive` is true only when a tool handler is registered (dataset mounted), which blocks chat input entirely without a dataset
- The new model allows chat without a dataset — messages are sent without tableSchema, the LLM responds conversationally
- Tool execution is a separate concern: if a tool call comes back but no handler is registered, show a "navigate to table view" prompt
- Session state machine makes the lifecycle explicit and testable

**State transitions:**
```
idle → active:  POST /sessions succeeds (ChatView mount)
idle → loaded:  GET /sessions/:id succeeds (resume from URL)
active → idle:  "New Session" clicked (reset)
loaded → idle:  "New Session" clicked (reset)
```

**What changes in useChatEngine:**
- `sessionIdRef` → `sessionId` (useState, not ref — drives renders)
- `isActive` removed — chat input always enabled when session exists
- `handleSubmit` no longer checks `toolHandler` before sending — it sends without schema if no handler
- Tool call results from LLM checked against `toolHandlerRef` — if null, show navigation prompt instead of executing

### D4: Unified nav replaces conditional OrgNav/ProjectNav

**Decision:** Replace the conditional rendering of OrgNav (when no project selected) and ProjectNav (when project selected) with a single `UnifiedNav` component that always shows the same structure: New Session, Projects, Chats, Recent Sessions.

**Rationale:**
- The current conditional nav is tied to the old routing model where AppShell derives projectId from URL params
- The new routes don't nest under `/projects/:projectId` uniformly — `/table/:datasetId` and `/chat/:sessionId` have no project in the URL
- A unified nav provides consistent navigation regardless of current route
- Project/dataset browsing moves to the content area (ProjectGrid, DatasetGrid components)

**What happens to ProjectNav/OrgNav:** Deprecated. Their content (project list, dataset list) moves to dedicated route components (`/projects`, `/projects/:projectId`).

### D5: TableView inline chat shares session, not a new engine

**Decision:** TableView's inline chat input connects to the same ChatContext session that ChatView uses. It's the same `useChatEngine` instance — just a different input UI.

**Rationale:**
- A separate chat engine for TableView would create disconnected sessions — messages in TableView wouldn't appear in ChatView history
- The spec requires "all messages are recorded in one continuous session"
- Sharing the engine means navigating from ChatView to TableView preserves conversation context
- The activity log overlay is a view-only component that reads from the shared message array

**Implementation:** TableView renders its own input bar and activity log, but calls the same `handleSubmit` and reads the same `messages` from `useChatContext()`. The DatasetDetail component continues to register `toolHandler` and `tableSchema` on mount.

### D6: Dataset context picker is a chat message component, not a modal

**Decision:** When a table operation is issued without dataset context, render an inline dataset picker as a special message in the chat history — not a modal or popover.

**Rationale:**
- Keeps the user in the chat flow — no context switch to a modal
- The picker becomes part of the conversation history, providing context for what happened
- Consistent with the Claude.ai pattern of inline interactive elements
- Simpler to implement: it's a React component rendered inside the message list

**Implementation:** A new message type `widget: { type: "dataset-picker" }` triggers rendering a `DatasetPicker` component inline. On selection, it fires a callback that sets the dataset context and re-submits the original command.

### D7: /table/:datasetId derives projectId from dataset API response

**Decision:** The `/table/:datasetId` route does not include projectId in the URL. TableView fetches the dataset, which includes `project_id`, and uses that for any project-scoped operations.

**Rationale:**
- Shorter, cleaner URLs (`/table/ds-123` vs `/projects/proj-456/datasets/ds-123`)
- The dataset→project relationship is already in the API response — no extra fetch needed
- Breadcrumbs can still show the project name by fetching the project (or including it in dataset response)
- Trade-off: deep-linking to a dataset doesn't immediately reveal the project from the URL alone. Acceptable — the UI shows it.

## Architecture

### Component Tree (new)

```
<BrowserRouter>
  <AuthProvider>
    <Routes>
      {/* Public */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/callback" element={<AuthCallback />} />

      {/* Protected */}
      <Route element={<RequireAuth><RequireOrg><AppShell /></RequireOrg></RequireAuth>}>
        <Route index element={<ChatView />} />
        <Route path="chat/:sessionId" element={<ChatView />} />
        <Route path="projects" element={<ProjectGrid />} />
        <Route path="projects/:projectId" element={<DatasetGrid />} />
        <Route path="table/:datasetId" element={<TableView />} />
        <Route path="sessions" element={<SessionList />} />
      </Route>
    </Routes>
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
                    │    idle     │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │ mount at /  │ mount at   │
              │             │ /chat/:id  │
              ▼             │            ▼
     POST /sessions         │     GET /sessions/:id
              │             │            │
              ▼             │            ▼
        ┌─────────┐        │     ┌──────────┐
        │ active  │        │     │  loaded   │
        └────┬────┘        │     └─────┬─────┘
             │             │           │
             │  "New Session" clicked  │
             └────────────►┤◄──────────┘
                           │
                    ┌──────┴──────┐
                    │    idle     │
                    └─────────────┘
```

### Shared Chat Components

```
frontend/src/ui/components/chat/
  MessageBubble.tsx          # Extracted from ChatPanel (user/assistant bubbles)
  MessageList.tsx            # Scrollable message container with auto-scroll
  ChatInput.tsx              # Expanding textarea + gutter (shared by ChatView + TableView)
  WelcomeState.tsx           # Greeting + suggestion chips (ChatView only)
  ActivityLog.tsx            # Overlay for TableView
  DatasetPicker.tsx          # Inline dataset/project selector
  SessionItem.tsx            # Nav item for recent sessions
```

### Session Query Hooks

```typescript
// frontend/src/ui/hooks/useSessions.ts

// Fetch recent sessions for nav sidebar
const useRecentSessions = (orgId: string, limit = 5) =>
  useQuery({
    queryKey: sessionKeys.recent(orgId, limit),
    queryFn: () => chatClient.listSessions({ orgId, limit }),
  });

// Fetch single session with turns (for resume)
const useSession = (sessionId: string) =>
  useQuery({
    queryKey: sessionKeys.detail(sessionId),
    queryFn: () => chatClient.getSession(sessionId),
    enabled: !!sessionId,
  });

// Update session title or dataset_id
const useUpdateSession = () =>
  useMutation({
    mutationFn: ({ sessionId, ...body }) => chatClient.updateSession(sessionId, body),
    onMutate: optimisticTitleUpdate,
  });
```

### ChatClient API Changes

The `ChatClient` needs updates to match the worker's org-scoped session API:

```typescript
// Current
createSession(projectId: string, datasetId?: string): Promise<ChatSession>
listSessions(datasetId: string): Promise<ChatSession[]>

// New
createSession(orgId: string, opts?: { projectId?: string; datasetId?: string; title?: string }): Promise<ChatSession>
listSessions(params: { orgId: string; limit?: number }): Promise<ChatSession[]>
updateSession(sessionId: string, body: { title?: string; dataset_id?: string | null }): Promise<ChatSession>
```

## Migration

This is a frontend-only change with no data migration required. The approach is:

1. **Phase 1 — Foundation**: Refactor AppShell layout (remove ChatPanelConnected), update routes, extract shared chat components. Tests will break during this phase.
2. **Phase 2 — New views**: Build ChatView, TableView (refactored DatasetView), UnifiedNav, SessionList. Wire up to ChatContext.
3. **Phase 3 — Context refactor**: Refactor useChatEngine to session-centric model. Update ChatClient API. Add dataset picker.
4. **Phase 4 — Polish**: Session titles, activity log, navigation state preservation, test fixes.

No feature flags needed — this is a UI restructure, not a gradual rollout. All changes land together on the feature branch.
