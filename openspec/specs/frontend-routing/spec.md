## Purpose

Describes the frontend route table that maps URLs to top-level page components. It defines the chat-first information architecture (`/` is ChatView, `/table/:datasetId`, `/view/:viewId`, `/projects`, `/sessions`) and the canonical URL schema used for deep links and navigation.

## Requirements

### Requirement: Route Table Restructuring

The frontend route configuration SHALL be restructured to support chat-first navigation.

**Current routes:**
| Route | Component |
|-------|-----------|
| `/` | OrgView (project grid) |
| `/projects/:projectId` | ProjectView (dataset browser) |
| `/projects/:projectId/datasets/:datasetId` | ProjectView (dataset detail) |
| `/projects/:projectId/datasets/:datasetId/sessions` | SessionList |
| `/projects/:projectId/datasets/:datasetId/sessions/:channelId` | SessionViewer |

**New routes:**
| Route | Component | Description |
|-------|-----------|-------------|
| `/` | ChatView | New session (landing page) |
| `/chat/:channelId` | ChatView | Resume existing session (Stream channel) |
| `/projects` | ProjectGrid | Project list (was `/`) |
| `/projects/:projectId` | DatasetGrid | Datasets within project |
| `/table/:datasetId` | TableView | Full-width table with inline chat |
| `/sessions` | SessionList | All org sessions |

#### Scenario: Root route shows ChatView

- **WHEN** an authenticated user navigates to `/`
- **THEN** ChatView SHALL render as the content area
- **THEN** the project grid SHALL NOT be visible

#### Scenario: Project grid moved to /projects

- **WHEN** the user navigates to `/projects`
- **THEN** the project grid SHALL render (same content as current `/`)

#### Scenario: Dataset table at /table/:datasetId

- **WHEN** the user navigates to `/table/ds-123`
- **THEN** the TableView SHALL render with dataset `ds-123` loaded
- **THEN** the table SHALL be full-width (no chat sidebar)

---

### Requirement: Route Guards Preserved

All protected routes SHALL continue to require authentication and organization membership.

- `RequireAuth` guard SHALL wrap all routes except `/login`, `/logout`, `/auth/callback`.
- `RequireOrg` guard SHALL wrap all routes except auth routes and `/org/create`.
- Guard behavior SHALL be unchanged from current implementation.

#### Scenario: Unauthenticated user redirected

- **WHEN** an unauthenticated user navigates to `/`
- **THEN** they SHALL be redirected to `/login`

---

### Requirement: /table/:datasetId Derives Project Context

The `/table/:datasetId` route omits `projectId` from the URL. The TableView component SHALL derive project context from the dataset's metadata.

- When TableView loads, it SHALL fetch the dataset via the backend API.
- The dataset response includes `project_id` — this SHALL be used for any operations requiring project context (e.g., upload, breadcrumbs).
- If breadcrumb navigation is shown, it SHALL display: Projects > {Project Name} > {Dataset Name}.

#### Scenario: Project derived from dataset

- **GIVEN** dataset `ds-123` belongs to project `proj-456`
- **WHEN** the user navigates to `/table/ds-123`
- **THEN** the system SHALL fetch the dataset and resolve `project_id = proj-456`
- **THEN** any breadcrumb or context display SHALL show the correct project name
