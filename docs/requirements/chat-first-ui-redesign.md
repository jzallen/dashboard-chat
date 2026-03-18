# Chat-First UI Redesign

## Status: Active

## Problem

The current UI is dataset-centric: the landing page is a project grid, chat is a fixed-width sidebar that only activates after selecting a dataset, and sessions are scoped to individual datasets. This creates friction:

- Users must navigate through projects and datasets before they can chat
- Chat sessions can't span multiple datasets or start without a dataset
- The fixed chat panel wastes screen space when not in use and constrains the table view

## Proposed Solution

Transform the app into a **chat-first experience** inspired by Claude.ai:

- Chat is the landing page — always enabled, no dataset required
- 2-panel layout (collapsible nav + full-width content) replaces the 3-panel layout
- Sessions are org-scoped, not dataset-scoped
- Table view has inline chat with an activity log overlay instead of a permanent sidebar

## Feature Spec

See `features/chat-first-ui.feature` for the full Gherkin specification (27 scenarios).

## Business Rules

### BR-1: Chat is always enabled
The chat input must be functional on the landing page without any dataset selected. When the user issues a table operation command without a dataset, the system prompts them to select one inline.

### BR-2: Sessions are org-scoped
A session belongs to the organization, not a specific dataset. Users can switch dataset context within a single session. All messages are recorded in one continuous session regardless of dataset changes.

### BR-3: Session title auto-set from first message
When the user sends the first message in a new session, the session title is automatically set to the first message (truncated to 100 characters). Titles are editable after creation.

### BR-4: Project selection during upload
When the user initiates an upload from ChatView and the organization has multiple projects, the chat must prompt for project selection. If only one project exists, it is auto-selected.

### BR-5: Recent sessions in nav
The nav sidebar displays up to 5 most recent sessions (across the entire org). Each shows a truncated title or first message as its label.

### BR-6: Activity log in TableView
When the user sends chat commands in TableView, an activity log overlay shows truncated recent messages with timestamps. Full messages are still posted to the session history.

### BR-7: Dataset context persists within session
When a dataset is selected as context (either via inline picker or by navigating to TableView), that context persists for the remainder of the session unless explicitly changed. The dataset name is shown in the input gutter.

### BR-8: Navigation state preservation
When the user navigates from TableView to ChatView (or vice versa), the previous view's state should be preserved for navigation back.

## Domain Model Changes

### Session Metadata (worker)
| Field | Current | Target |
|-------|---------|--------|
| `org_id` | Not present | **Required** string |
| `project_id` | Required string | **Optional** string (nullable) |
| `dataset_id` | Required string | **Optional** string (nullable) |
| `title` | Not present | **Optional** string (nullable, editable) |

### Session API Changes
| Endpoint | Current | Target |
|----------|---------|--------|
| `POST /sessions` | Requires `project_id`, `dataset_id` | Requires `org_id`; `project_id`, `dataset_id`, `title` optional |
| `GET /sessions` | Requires `dataset_id` query param | Requires `org_id` query param; supports `?limit=N` |
| `PATCH /sessions/:id` | Does not exist | New — updates `title` and/or `dataset_id` |

### Session Storage (S3 path)
| Current | Target |
|---------|--------|
| `sessions/{projectId}/{datasetId}/{sessionId}.jsonl` | `sessions/{orgId}/{sessionId}.jsonl` |

Legacy path must be supported via dual-read fallback during migration.

### Session Storage (Redis keys)
| Current | Target |
|---------|--------|
| `dataset:{datasetId}:sessions` (set) | `org:{orgId}:sessions` (sorted set, scored by timestamp) |

Keep `dataset:{datasetId}:sessions` for backward compatibility during migration.

## Route Changes

| Current Route | New Route | View |
|---------------|-----------|------|
| `/` (OrgView — project grid) | `/` (ChatView — chat landing) | Chat is the default |
| — | `/chat/:sessionId` | Resume a session |
| — | `/projects` | Project grid (moved from `/`) |
| `/projects/:projectId` (ProjectView) | `/projects/:projectId` | Dataset grid for project |
| `/projects/:projectId/datasets/:datasetId` | `/table/:datasetId` | Table view (full width) |
| `/projects/:projectId/datasets/:datasetId/sessions` | `/sessions` | All sessions (org-scoped) |
| `/projects/:projectId/datasets/:datasetId/sessions/:id` | `/sessions/:sessionId` | Session replay (read-only) |

## Layout Changes

| Current | Target |
|---------|--------|
| 3-panel: SideNav \| Content \| ChatPanel (384px fixed) | 2-panel: SideNav \| Content (full width) |
| SideNav shows OrgNav or ProjectNav conditionally | SideNav shows unified nav: New Session, Projects, Chats + recent sessions |
| ChatPanel is a layout fixture in AppShell | Chat is a routed view (ChatView) or inline in TableView |

## Acceptance Criteria

1. **Landing page**: Navigating to `/` shows ChatView with welcome message and suggestion chips
2. **Always-on chat**: User can type and send messages without selecting a dataset
3. **Dataset context flow**: Table operation without dataset → inline picker → select → command re-processed
4. **Upload flow**: Upload CSV chip → if multiple projects, inline project picker → upload completes
5. **Navigation**: Projects → project grid → click project → dataset grid → click dataset → TableView
6. **TableView**: Full-width table, slim chat input at bottom, activity log overlay on messages
7. **Sessions org-scoped**: Sessions created with `org_id`, listed by org, dataset context switchable
8. **Session titles**: First message auto-sets title; title editable in nav and Chats view
9. **Recent sessions**: Nav shows 5 most recent sessions; clicking one loads it in ChatView
10. **Chats view**: `/sessions` shows all org sessions sorted by recency
11. **2-panel layout**: No permanent chat sidebar; SideNav collapses/expands smoothly
12. **Backward compat**: Existing sessions readable via dual-read S3 fallback
13. **Tests pass**: `npm run test` and `cd backend && uv run pytest` both pass after changes

## Migration Strategy

- New sessions use org-scoped keys/paths immediately
- `getSession()` checks new S3 path first, falls back to legacy `sessions/{projectId}/{datasetId}/` path
- One-time migration script moves existing sessions to new structure (future task)
- Remove dual-read after migration complete

## Out of Scope (Future)

- Auto-generated session titles via AI (after N turns)
- Session search (full-text across messages)
- Session pinning (pin to top of nav)
- Keyboard shortcuts (Cmd+K for new session, Cmd+/ for nav toggle)
