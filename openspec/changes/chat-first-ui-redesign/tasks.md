## Phase 0: Dead Code Cleanup

### 0. Remove Dead Session Infrastructure

- [x] 0.1 Delete `worker/lib/s3.ts` — dead code, `@aws-sdk` not in worker dependencies, never imported.
- [x] 0.2 Remove dead methods from `ChatClient` in `frontend/src/core/chat/client.ts`: `createSession`, `logTurn`, `getSession`, `listSessions`. Keep `fetchChatStream` (the only method that works — POST /chat).
- [x] 0.3 Remove `ChatSession` and `ChatTurn` types from `client.ts` (orphaned by method removal).
- [x] 0.4 Delete `frontend/src/ui/components/SessionViewer/` — both `SessionList.tsx` and `index.tsx` call dead ChatClient methods (always 404). Replaced by new Stream-backed SessionList in Phase 3.
- [x] 0.5 Remove the `/projects/:projectId/datasets/:datasetId/sessions/:sessionId` route from `App.tsx`.
- [x] 0.6 Update or remove tests that reference deleted components/methods: `frontend/src/core/chat/__tests__/chat.test.ts`, `frontend/src/ui/context/__tests__/ChatContext.test.tsx`.
- [x] 0.7 Verify `npm run test` passes after cleanup.

---

## Phase 1: Foundation (Layout + Routing + Shared Components)

### 1. Extract Shared Chat Components

- [x] 1.1 Create `frontend/src/ui/components/chat/MessageBubble.tsx` — extract from ChatPanel. Props: `message: Message`, `isStreaming: boolean`. Renders user/assistant bubbles with streaming indicator.
- [x] 1.2 Create `frontend/src/ui/components/chat/MessageList.tsx` — scrollable container with auto-scroll-to-bottom behavior. Props: `messages: Message[]`, `chatEndRef`. Extracts scroll logic from ChatPanel.
- [x] 1.3 Create `frontend/src/ui/components/chat/ChatInput.tsx` — expanding textarea with gutter. Props: `input, setInput, onSubmit, isLoading, datasetName?: string`. Textarea auto-expands on multiline. Gutter shows dataset name (right-aligned) when provided.
- [x] 1.4 Create `frontend/src/ui/components/chat/WelcomeState.tsx` — greeting message + suggestion chips. Props: `onUploadCsv, onBrowseProjects`. Renders centered welcome with clickable chips.
- [x] 1.5 Create barrel export `frontend/src/ui/components/chat/index.ts` re-exporting all shared components.
- [x] 1.6 Write tests for ChatInput (expanding behavior, submit on Enter, Shift+Enter newline, gutter display).

### 2. Refactor AppShell to 2-Panel Layout

- [x] 2.1 Remove `<ChatPanelConnected />` from `AppShell/index.tsx`. The shell renders only `<SideNav>` + `<main><Outlet /></main>`.
- [x] 2.2 Update `AppShell.module.css` — remove any styles dependent on the 3-panel layout. Content area should be `flex-1` filling all remaining space.
- [x] 2.3 Update AppShell outlet context: provide `orgId`, `orgName`, `projects` (drop `project` since projectId is no longer derived from URL in the shell).
- [x] 2.4 Remove `ChatPanelConnected.tsx` — its responsibilities move to ChatView and TableView.
- [x] 2.5 Update existing tests that reference AppShell's 3-panel structure or ChatPanelConnected.

### 3. Update Route Table

- [x] 3.1 Rewrite route definitions in `App.tsx`:
  - `/` → `<ChatView />` (new)
  - `/chat/:channelId` → `<ChatView />` (new)
  - `/projects` → `<ProjectGrid />` (rename/move existing OrgView)
  - `/projects/:projectId` → `<DatasetGrid />` (rename/refactor existing ProjectView catalog mode)
  - `/table/:datasetId` → `<TableView />` (new, wraps refactored DatasetDetail)
  - `/sessions` → `<SessionList />` (new)
- [x] 3.2 Preserve auth guards: `RequireAuth` + `RequireOrg` wrapping the AppShell route group.
- [x] 3.3 Create stub components for new routes (ChatView, TableView, SessionList) returning placeholder text — enables routing to work before full implementation.
- [x] 3.4 Rename `OrgView` to `ProjectGrid` and update its route from `/` to `/projects`. Ensure it reads `projects` from outlet context.
- [x] 3.5 Extract dataset grid from `ProjectView` into `DatasetGrid` component at `/projects/:projectId`. It reads `projectId` from `useParams()`.
- [x] 3.6 Update all `<Link>` and `useNavigate()` calls throughout the app to use new route paths (e.g., `/projects` instead of `/`, `/table/:id` instead of `/projects/:pid/datasets/:did`).

---

## Phase 2: Stream Session Refactor

### 4. Remap useSessionContext to Org-Scoped Channels

- [x] 4.1 Refactor `useSessionContext` signature from `useSessionContext(projectId)` to `useSessionContext(orgId)`.
- [x] 4.2 Update `createSession` to create channels with ID format `chat_{orgId}_{uuid}` and custom data `{ orgId, projectId: null, datasetId: null, title: null, createdAt }`.
- [x] 4.3 Update channel query filter from `{ "custom.projectId": pid }` to `{ "custom.orgId": orgId }`.
- [x] 4.4 Add `resumeSession(channelId)` method: calls `client.channel("messaging", channelId).watch()`, sets as current channel.
- [x] 4.5 Remove auto-create-on-project-load behavior (the `useEffect` that creates a channel when `projectId` changes). Channel creation is now explicit via ChatView mount.
- [x] 4.6 Remove freeze logic (`checkAndFreeze`, `isFrozen`, `FREEZE_THRESHOLD_MS`) — not part of this change's scope. Can be re-added later.
- [x] 4.7 Write tests for refactored useSessionContext: org-scoped creation, resume by ID, queryChannels.

### 5. Refactor useChatEngine to Own Channel Lifecycle

- [x] 5.1 Replace `currentChannelRef` + `registerCurrentChannel()` with `channel` (useState) managed internally. Expose `createChannel(orgId)` and `loadChannel(channelId)` methods.
- [x] 5.2 Remove `isActive` state. Chat input is always enabled when `channel !== null`.
- [x] 5.3 Update `submitText`: remove the `if (!hasToolHandler) return` gate. Send messages regardless of tool handler presence.
- [x] 5.4 Update `submitText`: if `tableSchemaRef.current` is null, call `chatClient.fetchChatStream(apiMessages, null)`. If tool calls are returned but `toolHandlerRef.current` is null, append a system message: "Navigate to the table view to execute this operation" with link to `/table/{datasetId}`.
- [x] 5.5 Update `registerDatasetId`: in addition to setting entity context, call `channel.updatePartial({ set: { datasetId } })` to persist in channel custom data.
- [x] 5.6 Add `setTitle(title)` method: calls `channel.updatePartial({ set: { title } })`. Used for auto-title from first message.
- [x] 5.7 Remove `registerCurrentChannel` from the exported context value.
- [x] 5.8 `buildApiMessages()` — no changes needed (already reads from `channel.state.messages`).
- [x] 5.9 `writeToStream()` — no changes needed (already writes to current channel).
- [x] 5.10 Write tests: channel creation, channel loading, chat without dataset, tool call without handler shows navigation prompt, title auto-set.

---

## Phase 3: New Views

### 6. Build ChatView

- [x] 6.1 Create `frontend/src/ui/components/ChatView/index.tsx`. Full-width layout: centered content column (max-width ~768px), MessageList above, ChatInput below.
- [x] 6.2 On mount at `/` (no channelId param): call `useChatContext().createChannel(orgId)` from outlet context, then `history.replace(`/chat/${channelId}`)`.
- [x] 6.3 On mount at `/chat/:channelId`: call `useChatContext().loadChannel(channelId)`, populate messages from `channel.state.messages`.
- [x] 6.4 Render WelcomeState when messages array is empty. Hide it after first message sent.
- [x] 6.5 Wire ChatInput submit to `useChatContext().handleSubmit`. Display dataset name in gutter from `channel.data.datasetId` (resolved to name via dataset API or cache).
- [x] 6.6 Create `ChatView.module.css` with full-width layout, centered column, proper spacing.
- [x] 6.7 Write tests: renders welcome state, creates channel on mount, resumes channel from URL, sends messages.

### 7. Build UnifiedNav

- [x] 7.1 Create `frontend/src/ui/components/SideNav/UnifiedNav.tsx`. Renders: New Session button (plus icon), Projects link (folder icon), Chats link (messages icon).
- [x] 7.2 Add active route highlighting: match current pathname against `/`, `/chat/*` (sessions), `/projects/*` (projects), `/sessions` (chats).
- [x] 7.3 Add Recent Sessions section. Use `client.queryChannels({ type: "messaging", "custom.orgId": orgId }, { last_message_at: -1 }, { limit: 5, watch: true })` for real-time updates.
- [x] 7.4 Each recent session item shows: `channel.data.title` or first message text (truncated ~40 chars), relative timestamp from `channel.state.last_message_at`. Clicking navigates to `/chat/{channel.id}`.
- [x] 7.5 Replace OrgNav/ProjectNav rendering in SideNav with `<UnifiedNav />`. Remove conditional logic based on projectId.
- [x] 7.6 Ensure collapsed state still works: show only icons for main items, hide recent sessions.
- [x] 7.7 Write tests: renders nav items, highlights active route, shows recent sessions, navigates on click.

### 8. Build TableView

- [x] 8.1 Create `frontend/src/ui/components/TableView/index.tsx`. Reads `datasetId` from `useParams()`. Fetches dataset, derives `projectId` from response.
- [x] 8.2 Render the data table at full width (reuse table rendering logic from DatasetDetail — extract if needed).
- [x] 8.3 Add slim ChatInput bar fixed at bottom. Dataset name in gutter auto-set from dataset metadata.
- [x] 8.4 On mount: update channel's `datasetId` via `channel.updatePartial({ set: { datasetId } })` if different from current context.
- [x] 8.5 Register toolHandler and tableSchema with ChatContext on mount (same pattern as current DatasetDetail useEffects).
- [x] 8.6 Create `ActivityLog` overlay component: semi-transparent panel on right side, shows recent messages with timestamps, auto-dismisses after 5s inactivity.
- [x] 8.7 Wire ChatInput submit to shared ChatContext. Show new messages in ActivityLog instead of a message list.
- [x] 8.8 Create `TableView.module.css` with full-width table, bottom input bar, activity log positioning.
- [x] 8.9 Write tests: loads dataset, registers tool handler, sends commands, shows activity log.

### 9. Build SessionList Page

- [x] 9.1 Create `frontend/src/ui/components/SessionList/index.tsx`. Uses `client.queryChannels({ type: "messaging", "custom.orgId": orgId }, { last_message_at: -1 }, { limit: 30 })` with pagination.
- [x] 9.2 Render session rows: `channel.data.title` (or first message preview), relative timestamp, dataset name badge from `channel.data.datasetId` (if set). Sorted by most recent first.
- [x] 9.3 Clicking a row navigates to `/chat/{channel.id}`.
- [x] 9.4 Add inline title editing: click edit icon → text field → `channel.updatePartial({ set: { title } })` on confirm.
- [x] 9.5 Write tests: renders session list, navigates on click, title editing works.

---

## Phase 4: Polish

### 10. Session Title Management

- [x] 10.1 In `useChatEngine` `submitText`: after the first message in a new session (channel has no messages yet), call `channel.updatePartial({ set: { title: text.slice(0, 100) } })`. Fire-and-forget.
- [x] 10.2 The nav recent sessions list updates automatically via Stream's WebSocket (no manual query invalidation needed).
- [x] 10.3 Add inline title editing to UnifiedNav recent sessions: double-click to edit, Enter to confirm, calls `channel.updatePartial()`.
- [x] 10.4 Write tests: title auto-set on first message, title editable in nav, title editable in session list.

### 11. Dataset Context Picker

- [x] 11.1 Create `frontend/src/ui/components/chat/DatasetPicker.tsx`. Fetches datasets from backend API. Renders inline list with dataset name + project name. Fires `onSelect(datasetId)` callback.
- [x] 11.2 Add table-operation detection in ChatContext: before sending to worker, check if the message likely needs a dataset (heuristic: keywords like "filter", "sort", "add row", "delete", "clean") and no datasetId is set in channel custom data.
- [x] 11.3 When detected: instead of sending to worker, append an assistant message with `widget: { type: "dataset-picker" }` and store the pending command.
- [x] 11.4 On dataset selection: call `channel.updatePartial({ set: { datasetId } })`, fetch table schema, re-submit the pending command.
- [x] 11.5 Create `ProjectPicker.tsx` for upload flow: similar inline list but shows projects. Auto-select if only one project.
- [x] 11.6 Write tests: picker renders datasets, selection sets context, command re-submitted.

### 12. Navigation State Preservation

- [x] 12.1 Wrap TableView table state (filters, sorting, column visibility) in a context or ref that persists across route changes.
- [x] 12.2 Use `useRef` or a lightweight store (e.g., Map keyed by datasetId) to cache table state across navigations.
- [x] 12.3 On TableView mount: restore cached state for the datasetId if available.
- [x] 12.4 Write test: apply filter in TableView, navigate away, navigate back, filter still applied.

### 13. Cleanup and Test Fixes

- [x] 13.1 Remove deprecated components: `ChatPanel/index.tsx`, `ChatPanelConnected.tsx`, `OrgNav.tsx`. Remove their CSS modules and test files.
- [x] 13.2 Update or remove tests that reference removed components or old route paths.
- [x] 13.3 Run `npm run test` — fix all frontend test failures.
- [x] 13.4 Run `npm run test:all` — verify backend tests still pass (should be unaffected).
- [x] 13.5 Manual smoke test: new session flow, resume session, project browsing, dataset table, inline chat, activity log, session list.
