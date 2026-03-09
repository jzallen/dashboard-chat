## Why

The current UI is dataset-centric: the landing page is a project grid, chat is a fixed 384px right sidebar that only activates after selecting a dataset, and the SideNav shows projects/datasets with no session awareness. This creates friction — users must navigate through projects and datasets before they can chat, and chat sessions can't exist independently of a dataset context.

The worker session model is already org-scoped (org_id required, project_id/dataset_id optional, S3 paths use `sessions/{orgId}/{sessionId}.jsonl`), but the frontend doesn't leverage this. The gap is entirely in the frontend architecture: routing, layout, and navigation.

## What Changes

- **Replace 3-panel layout with 2-panel layout** — Remove the fixed ChatPanel sidebar from AppShell. Chat becomes a routed view (ChatView) that fills the content area, not a permanent layout fixture.
- **Make ChatView the landing page** — Root route `/` renders ChatView with welcome state and suggestion chips instead of OrgView (project grid).
- **Add new routes** — `/chat/:sessionId` (resume session), `/projects` (moved from `/`), `/table/:datasetId` (full-width table with inline chat input), `/sessions` (org-scoped session list).
- **Redesign SideNav** — Replace conditional OrgNav/ProjectNav with unified nav: New Session button, Projects link, Chats link, and recent sessions list (up to 5).
- **Add inline chat input to TableView** — Slim input bar at bottom of table with activity log overlay instead of the permanent ChatPanel sidebar.
- **Add session title support** — Auto-set from first message, editable via PATCH endpoint (already exists on worker).
- **Add dataset context picker in chat** — When a table operation is issued without dataset context, show inline picker. Context persists within session.

## Capabilities

### New Capabilities
- `chat-view`: Full-width chat interface as a routed view. Renders message history, suggestion chips (welcome state), expanding textarea input with dataset context gutter. Replaces the ChatPanel sidebar for standalone chat interactions.
- `table-view-inline-chat`: Slim chat input bar at the bottom of TableView with activity log overlay. Replaces the ChatPanel sidebar for dataset-scoped interactions.
- `unified-nav`: Redesigned SideNav with New Session, Projects, Chats links and recent sessions list. Replaces the conditional OrgNav/ProjectNav.
- `dataset-context-picker`: Inline dataset/project selection within chat when operations require context that hasn't been set.
- `session-title-management`: Auto-set session title from first message (frontend-side, using existing PATCH endpoint). Display titles in nav and session list.

### Modified Capabilities
- `app-shell-layout`: Changes from 3-panel (SideNav | Content | ChatPanel) to 2-panel (SideNav | Content). ChatPanelConnected removed from layout.
- `frontend-routing`: Route table restructured. Root becomes ChatView, project grid moves to `/projects`, dataset view becomes `/table/:datasetId`, new `/chat/:sessionId` and `/sessions` routes.
- `chat-context-management`: ChatContext decoupled from DatasetView registration. Context can be set via inline picker or by navigating to TableView. Session tracking becomes primary (not dataset tracking).

## Impact

### Frontend
- **Layout**: Remove `ChatPanelConnected` from `AppShell/index.tsx`. Content area becomes full-width.
- **Routing**: Rewrite route table in `App.tsx`. Add ChatView, TableView, SessionList routes. Move OrgView to `/projects`.
- **New components**: `ChatView` (full-width chat page), `TableView` (refactored DatasetView with inline chat), `UnifiedNav` (replaces OrgNav/ProjectNav), `ActivityLog` (overlay for TableView), `DatasetPicker` (inline selector), `SessionList` (org-scoped list page).
- **Modified components**: `AppShell` (2-panel), `SideNav` (unified nav content), `ChatContext` (decouple from DatasetView lifecycle).
- **Query hooks**: Add `useRecentSessions(orgId, limit)` hook calling `GET /sessions?org_id=X&limit=5`. Add `useUpdateSession` mutation for title edits.
- **Removed components**: `ChatPanel` (replaced by ChatView + inline chat), `ChatPanelConnected` (layout wrapper removed), `OrgNav` (replaced by unified nav), potentially `ProjectNav` (simplified).

### Backend
- No changes required. Session management is on the worker. Project/dataset CRUD endpoints remain unchanged.

### Worker / Shared
- No structural changes required. The session API already supports:
  - `POST /sessions` with `org_id` required, `project_id`/`dataset_id`/`title` optional
  - `GET /sessions?org_id=X&limit=N` for listing
  - `PATCH /sessions/:id` for title/dataset_id updates
  - `GET /sessions/:id` for retrieval with Redis→S3 fallback
- The chat handler (`handleChat`) is stateless — it takes messages + tableSchema per request. No changes needed.

### Infrastructure
- No new services, environment variables, or infrastructure changes.
- No database migrations (sessions are in Redis/S3, not SQL).
- Docker Compose and CI/CD pipelines unchanged.
