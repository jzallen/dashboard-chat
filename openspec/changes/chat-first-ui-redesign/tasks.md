## Phase 1: Foundation (Layout + Routing + Shared Components)

### 1. Extract Shared Chat Components

- [ ] 1.1 Create `frontend/src/ui/components/chat/MessageBubble.tsx` — extract from ChatPanel. Props: `message: Message`, `isStreaming: boolean`. Renders user/assistant bubbles with streaming indicator.
- [ ] 1.2 Create `frontend/src/ui/components/chat/MessageList.tsx` — scrollable container with auto-scroll-to-bottom behavior. Props: `messages: Message[]`, `chatEndRef`. Extracts scroll logic from ChatPanel.
- [ ] 1.3 Create `frontend/src/ui/components/chat/ChatInput.tsx` — expanding textarea with gutter. Props: `input, setInput, onSubmit, isLoading, datasetName?: string`. Textarea auto-expands on multiline. Gutter shows dataset name (right-aligned) when provided.
- [ ] 1.4 Create `frontend/src/ui/components/chat/WelcomeState.tsx` — greeting message + suggestion chips. Props: `onUploadCsv, onBrowseProjects`. Renders centered welcome with clickable chips.
- [ ] 1.5 Create barrel export `frontend/src/ui/components/chat/index.ts` re-exporting all shared components.
- [ ] 1.6 Write tests for ChatInput (expanding behavior, submit on Enter, Shift+Enter newline, gutter display).

### 2. Refactor AppShell to 2-Panel Layout

- [ ] 2.1 Remove `<ChatPanelConnected />` from `AppShell/index.tsx`. The shell renders only `<SideNav>` + `<main><Outlet /></main>`.
- [ ] 2.2 Update `AppShell.module.css` — remove any styles dependent on the 3-panel layout. Content area should be `flex-1` filling all remaining space.
- [ ] 2.3 Update AppShell outlet context: provide `orgId`, `orgName`, `projects` (drop `project` since projectId is no longer derived from URL in the shell).
- [ ] 2.4 Remove `ChatPanelConnected.tsx` — its responsibilities move to ChatView and TableView.
- [ ] 2.5 Update existing tests that reference AppShell's 3-panel structure or ChatPanelConnected.

### 3. Update Route Table

- [ ] 3.1 Rewrite route definitions in `App.tsx`:
  - `/` → `<ChatView />` (new)
  - `/chat/:sessionId` → `<ChatView />` (new)
  - `/projects` → `<ProjectGrid />` (rename/move existing OrgView)
  - `/projects/:projectId` → `<DatasetGrid />` (rename/refactor existing ProjectView catalog mode)
  - `/table/:datasetId` → `<TableView />` (new, wraps refactored DatasetDetail)
  - `/sessions` → `<SessionList />` (new)
- [ ] 3.2 Preserve auth guards: `RequireAuth` + `RequireOrg` wrapping the AppShell route group.
- [ ] 3.3 Create stub components for new routes (ChatView, TableView, SessionList) returning placeholder text — enables routing to work before full implementation.
- [ ] 3.4 Rename `OrgView` to `ProjectGrid` and update its route from `/` to `/projects`. Ensure it reads `projects` from outlet context.
- [ ] 3.5 Extract dataset grid from `ProjectView` into `DatasetGrid` component at `/projects/:projectId`. It reads `projectId` from `useParams()`.
- [ ] 3.6 Update all `<Link>` and `useNavigate()` calls throughout the app to use new route paths (e.g., `/projects` instead of `/`, `/table/:id` instead of `/projects/:pid/datasets/:did`).

---

## Phase 2: New Views

### 4. Build ChatView

- [ ] 4.1 Create `frontend/src/ui/components/ChatView/index.tsx`. Full-width layout: centered content column (max-width ~768px), MessageList above, ChatInput below.
- [ ] 4.2 On mount at `/` (no sessionId param): call `POST /sessions` with `orgId` from outlet context, store sessionId, replace URL to `/chat/:sessionId`.
- [ ] 4.3 On mount at `/chat/:sessionId`: call `GET /sessions/:sessionId`, populate messages from turns, restore dataset context from session metadata.
- [ ] 4.4 Render WelcomeState when messages array is empty. Hide it after first message sent.
- [ ] 4.5 Wire ChatInput submit to `useChatContext().handleSubmit`. Display dataset name in gutter from session's dataset_id.
- [ ] 4.6 Create `ChatView.module.css` with full-width layout, centered column, proper spacing.
- [ ] 4.7 Write tests: renders welcome state, creates session on mount, resumes session from URL, sends messages.

### 5. Build UnifiedNav

- [ ] 5.1 Create `frontend/src/ui/components/SideNav/UnifiedNav.tsx`. Renders: New Session button (plus icon), Projects link (folder icon), Chats link (messages icon).
- [ ] 5.2 Add active route highlighting: match current pathname against `/`, `/chat/*` (sessions), `/projects/*` (projects), `/sessions` (chats).
- [ ] 5.3 Add Recent Sessions section below main items. Uses `useRecentSessions(orgId, 5)` hook (see task 7.1).
- [ ] 5.4 Each recent session item shows: truncated title (or first message), relative timestamp. Clicking navigates to `/chat/:sessionId`.
- [ ] 5.5 Replace OrgNav/ProjectNav rendering in SideNav with `<UnifiedNav />`. Remove conditional logic based on projectId.
- [ ] 5.6 Ensure collapsed state still works: show only icons for main items, hide recent sessions.
- [ ] 5.7 Write tests: renders nav items, highlights active route, shows recent sessions, navigates on click.

### 6. Build TableView

- [ ] 6.1 Create `frontend/src/ui/components/TableView/index.tsx`. Reads `datasetId` from `useParams()`. Fetches dataset, derives `projectId` from response.
- [ ] 6.2 Render the data table at full width (reuse table rendering logic from DatasetDetail — extract if needed).
- [ ] 6.3 Add slim ChatInput bar fixed at bottom. Dataset name in gutter auto-set from dataset metadata.
- [ ] 6.4 On mount: update session's dataset_id via `PATCH /sessions/:id` if different from current context.
- [ ] 6.5 Register toolHandler and tableSchema with ChatContext on mount (same pattern as current DatasetDetail useEffects).
- [ ] 6.6 Create `ActivityLog` overlay component: semi-transparent panel on right side, shows recent messages with timestamps, auto-dismisses after 5s inactivity.
- [ ] 6.7 Wire ChatInput submit to shared ChatContext. Show new messages in ActivityLog instead of a message list.
- [ ] 6.8 Create `TableView.module.css` with full-width table, bottom input bar, activity log positioning.
- [ ] 6.9 Write tests: loads dataset, registers tool handler, sends commands, shows activity log.

### 7. Build Session Hooks and API

- [ ] 7.1 Create `frontend/src/ui/hooks/useSessions.ts` with:
  - `useRecentSessions(orgId, limit)` — calls `GET /sessions?org_id=X&limit=5`
  - `useSession(sessionId)` — calls `GET /sessions/:id`
  - `useUpdateSession()` — mutation calling `PATCH /sessions/:id`
  - Query key factory: `sessionKeys.recent(orgId, limit)`, `sessionKeys.detail(id)`
- [ ] 7.2 Update `ChatClient` in `frontend/src/core/chat/client.ts`:
  - `createSession(orgId, opts?)` — takes orgId as primary param
  - `listSessions({ orgId, limit })` — org-scoped listing
  - `updateSession(sessionId, body)` — new method for PATCH
  - Update `ChatSession` type to include `org_id` and `title` fields
- [ ] 7.3 Write tests for session hooks (mock API responses, verify query keys).

### 8. Build SessionList Page

- [ ] 8.1 Create `frontend/src/ui/components/SessionList/index.tsx`. Fetches all sessions via `useRecentSessions(orgId)` (no limit or high limit).
- [ ] 8.2 Render session rows: title (or first message preview), relative timestamp, dataset name badge (if set). Sorted by most recent first.
- [ ] 8.3 Clicking a row navigates to `/chat/:sessionId`.
- [ ] 8.4 Write tests: renders session list, navigates on click.

---

## Phase 3: Context Refactor

### 9. Refactor ChatContext (useChatEngine)

- [ ] 9.1 Replace `sessionIdRef` with `useState<string | null>` — sessionId changes should trigger re-renders (for URL updates, nav list).
- [ ] 9.2 Remove `isActive` state. Chat input is always enabled when a session exists. The `handleSubmit` function no longer gates on toolHandler presence.
- [ ] 9.3 Update `handleSubmit`: if `tableSchemaRef.current` is null, send messages without schema (conversational mode). If tool calls are returned but `toolHandlerRef.current` is null, append a system message: "Navigate to the table view to execute this operation."
- [ ] 9.4 Update `registerDatasetId`: no longer clears sessionId. Dataset context changes within a session, not across sessions.
- [ ] 9.5 Add `loadSession(sessionId)` method: fetches session via GET, populates messages from turns, restores datasetId from metadata.
- [ ] 9.6 Add `createSession(orgId)` method: calls POST /sessions, stores sessionId, returns it for URL update.
- [ ] 9.7 Update `sessionLogger.ts`: use the already-created sessionId (no lazy creation). Skip logging if no tableSchema and no tool calls.
- [ ] 9.8 Write tests for new ChatContext behavior: session creation, session loading, chat without dataset, tool call without handler.

### 10. Dataset Context Picker

- [ ] 10.1 Create `frontend/src/ui/components/chat/DatasetPicker.tsx`. Fetches datasets from backend API. Renders inline list with dataset name + project name. Fires `onSelect(datasetId)` callback.
- [ ] 10.2 Add table-operation detection in ChatContext: before sending to worker, check if the message likely needs a dataset (heuristic: keywords like "filter", "sort", "add row", "delete", "clean") and no datasetId is set.
- [ ] 10.3 When detected: instead of sending to worker, append an assistant message with `widget: { type: "dataset-picker" }` and store the pending command.
- [ ] 10.4 On dataset selection: set dataset context via PATCH, register the schema (may need to fetch dataset data), re-submit the pending command.
- [ ] 10.5 Create `ProjectPicker.tsx` for upload flow: similar inline list but shows projects. Auto-select if only one project.
- [ ] 10.6 Write tests: picker renders datasets, selection sets context, command re-submitted.

---

## Phase 4: Polish

### 11. Session Title Management

- [ ] 11.1 In ChatContext `handleSubmit`: after the first message in a new session, call `PATCH /sessions/:id` with `title` set to the first user message (truncated to 100 chars). Fire-and-forget.
- [ ] 11.2 Invalidate `sessionKeys.recent` query after title update so nav sidebar refreshes.
- [ ] 11.3 Add inline title editing to UnifiedNav recent sessions: double-click to edit, Enter to confirm, calls `useUpdateSession` mutation.
- [ ] 11.4 Add inline title editing to SessionList rows: click edit icon, inline text field, optimistic update.
- [ ] 11.5 Write tests: title auto-set on first message, title editable in nav, title editable in session list.

### 12. Navigation State Preservation

- [ ] 12.1 Wrap TableView table state (filters, sorting, column visibility) in a context or ref that persists across route changes (React state survives if the component remounts with the same key).
- [ ] 12.2 Use `useRef` or a lightweight store (e.g., Map keyed by datasetId) to cache table state across navigations.
- [ ] 12.3 On TableView mount: restore cached state for the datasetId if available.
- [ ] 12.4 Write test: apply filter in TableView, navigate away, navigate back, filter still applied.

### 13. Cleanup and Test Fixes

- [ ] 13.1 Remove deprecated components: `ChatPanel/index.tsx`, `ChatPanelConnected.tsx`, `OrgNav.tsx`. Remove their CSS modules and test files.
- [ ] 13.2 Update or remove tests that reference removed components or old route paths.
- [ ] 13.3 Run `npm run test` — fix all frontend test failures.
- [ ] 13.4 Run `npm run test:all` — verify backend tests still pass (should be unaffected).
- [ ] 13.5 Manual smoke test: new session flow, resume session, project browsing, dataset table, inline chat, activity log, session list.
