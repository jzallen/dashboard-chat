## Why

The current UI is dataset-centric: the landing page is a project grid, chat is a fixed 384px right sidebar that only activates after selecting a dataset, and the SideNav shows projects/datasets with no session awareness. This creates friction — users must navigate through projects and datasets before they can chat, and chat sessions can't exist independently of a dataset context.

Stream Chat is already integrated as the persistence layer (channels store messages, `StreamProvider` manages auth). But the frontend doesn't leverage Stream's full capabilities — channels are scoped to projects, the UI still uses a fixed sidebar, and there's no session browsing or resumption. The gap is in the frontend architecture: routing, layout, navigation, and how Stream channels are created and queried.

## What Changes

- **Replace 3-panel layout with 2-panel layout** — Remove the fixed ChatPanel sidebar from AppShell. Chat becomes a routed view (ChatView) that fills the content area, not a permanent layout fixture.
- **Make ChatView the landing page** — Root route `/` renders ChatView with welcome state and suggestion chips instead of OrgView (project grid).
- **Add new routes** — `/chat/:channelId` (resume session), `/projects` (moved from `/`), `/table/:datasetId` (full-width table with inline chat input), `/sessions` (org-scoped session list).
- **Redesign SideNav** — Replace conditional OrgNav/ProjectNav with unified nav: New Session button, Projects link, Chats link, and recent sessions list (up to 5).
- **Add inline chat input to TableView** — Slim input bar at bottom of table with activity log overlay instead of the permanent ChatPanel sidebar.
- **Remap Stream channels from project-scoped to org-scoped** — Channels change from `project_{projectId}_{uuid}` to `chat_{orgId}_{uuid}` with optional `projectId`/`datasetId` as custom data.
- **Add session title support** — Auto-set from first message via `channel.updatePartial()`, editable inline.
- **Add dataset context picker in chat** — When a table operation is issued without dataset context, show inline picker. Context stored as channel custom data.
- **Clean up dead code** — Remove `worker/lib/s3.ts`, dead `ChatClient` session methods, broken `SessionViewer`/`SessionList` components that call non-existent worker routes.

## Capabilities

### New Capabilities
- `chat-view`: Full-width chat interface as a routed view. Renders message history from Stream channel, suggestion chips (welcome state), expanding textarea input with dataset context gutter. Replaces the ChatPanel sidebar for standalone chat interactions.
- `table-view-inline-chat`: Slim chat input bar at the bottom of TableView with activity log overlay. Replaces the ChatPanel sidebar for dataset-scoped interactions.
- `unified-nav`: Redesigned SideNav with New Session, Projects, Chats links and recent sessions list powered by Stream `queryChannels`. Replaces the conditional OrgNav/ProjectNav.
- `dataset-context-picker`: Inline dataset/project selection within chat when operations require context that hasn't been set. Context stored as Stream channel custom data.
- `session-title-management`: Auto-set session title from first message via `channel.updatePartial()`. Display titles in nav and session list.

### Modified Capabilities
- `app-shell-layout`: Changes from 3-panel (SideNav | Content | ChatPanel) to 2-panel (SideNav | Content). ChatPanelConnected removed from layout.
- `frontend-routing`: Route table restructured. Root becomes ChatView, project grid moves to `/projects`, dataset view becomes `/table/:datasetId`, new `/chat/:channelId` and `/sessions` routes.
- `chat-context-management`: ChatContext refactored to use Stream channels as session identity. Channel created eagerly on ChatView mount, resumed by channel ID from URL. `isActive` gating removed — chat works without a dataset. Entity context (datasetId, tableSchema) stored as channel custom data.
- `stream-session-scoping`: Channels remap from `project_{projectId}_{uuid}` to `chat_{orgId}_{uuid}`. Existing project-scoped channels are effectively archived (not queried by new nav).

### Removed Capabilities
- `dead-session-client`: ChatClient methods `createSession`, `logTurn`, `getSession`, `listSessions` removed (call non-existent worker routes, always 404).
- `dead-session-viewer`: SessionViewer and SessionList components removed (depend on dead ChatClient methods). Replaced by new SessionList backed by Stream.
- `dead-s3-client`: `worker/lib/s3.ts` removed (dead code, `@aws-sdk` not even in dependencies).

## Impact

### Frontend
- **Layout**: Remove `ChatPanelConnected` from `AppShell/index.tsx`. Content area becomes full-width.
- **Routing**: Rewrite route table in `App.tsx`. Add ChatView, TableView, SessionList routes. Move OrgView to `/projects`.
- **New components**: `ChatView` (full-width chat page), `TableView` (refactored DatasetView with inline chat), `UnifiedNav` (replaces OrgNav/ProjectNav), `ActivityLog` (overlay for TableView), `DatasetPicker` (inline selector), `SessionList` (org-scoped list backed by Stream `queryChannels`).
- **Modified components**: `AppShell` (2-panel), `SideNav` (unified nav content), `useChatEngine` (Stream channel as session identity, remove `isActive` gating), `useSessionContext` (org-scoped channel creation, resume by channel ID).
- **Removed components**: `ChatPanel`, `ChatPanelConnected`, `OrgNav`, `SessionViewer` (broken), old `SessionList` (broken). Dead `ChatClient` session methods.
- **Stream integration**: `useSessionContext` refactored from project-scoped to org-scoped. `queryChannels` used for recent sessions nav and session list page. `channel.updatePartial()` used for title and dataset context.

### Backend
- No changes required. Stream token endpoint already exists. Project/dataset CRUD endpoints unchanged.

### Worker
- **Deleted**: `worker/lib/s3.ts` (dead code). No other changes — worker only has `GET /health` and `POST /chat`.

### Infrastructure
- No new services, environment variables, or infrastructure changes.
- No database migrations.
- Docker Compose and CI/CD pipelines unchanged.
