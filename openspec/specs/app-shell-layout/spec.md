## Purpose

Describes the root React AppShell layout that hosts every authenticated page. It defines the panel composition (SideNav + routed content) and scaffolds the navigation and collapse behaviour every other frontend view relies on.

## Requirements

### Requirement: Two-Panel Layout

The AppShell layout SHALL change from a 3-panel layout (SideNav | Content | ChatPanel) to a 2-panel layout (SideNav | Content).

**Current behavior:**
- AppShell renders `<SideNav>`, `<main>` (content via Outlet), and `<ChatPanelConnected>` in a flex row.
- ChatPanelConnected is a 384px (`w-96`) fixed-width panel on the right.
- Content area is `flex-1`, squeezed between SideNav and ChatPanel.

**New behavior:**
- AppShell SHALL render only `<SideNav>` and `<main>` (content via Outlet) in a flex row.
- `ChatPanelConnected` SHALL be removed from the AppShell layout.
- The `<main>` content area SHALL expand to fill all space not used by SideNav.
- The SideNav collapse/expand behavior SHALL remain unchanged.

#### Scenario: No chat sidebar on any page

- **GIVEN** the user is on any route within the app
- **THEN** there SHALL be no fixed chat panel on the right side of the screen
- **THEN** the content area SHALL extend to the right edge of the viewport (minus any padding)

#### Scenario: SideNav still collapses

- **GIVEN** the user clicks the collapse toggle
- **THEN** the SideNav SHALL collapse to icon-only width
- **THEN** the content area SHALL expand to fill the freed space

---

### Requirement: AppShell Context Changes

The AppShell outlet context SHALL be updated to support the new routing structure.

**Current behavior:**
- AppShell provides `orgName`, `project`, `projects` via `useOutletContext`.
- `projectId` is derived from URL params within AppShell.

**New behavior:**
- AppShell SHALL provide `orgId`, `orgName`, `projects` via outlet context.
- AppShell SHALL NOT derive `projectId` from URL params (routes no longer nest under `/projects/:projectId` uniformly).
- Individual route components SHALL read their own params (e.g., TableView reads `datasetId`, ChatView reads `sessionId`).

#### Scenario: Route components read own params

- **GIVEN** the user navigates to `/table/ds-123`
- **THEN** the TableView component SHALL read `datasetId` from `useParams()`
- **THEN** the AppShell SHALL NOT need to know about `datasetId`
