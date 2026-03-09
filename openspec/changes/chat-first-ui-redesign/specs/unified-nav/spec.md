## ADDED Requirements

### Requirement: Unified Navigation Sidebar

The SideNav SHALL display a unified navigation structure that replaces the conditional OrgNav/ProjectNav pattern. The same nav items SHALL be visible regardless of the current route.

- The nav SHALL display these items in order:
  1. **New Session** — Button with plus/pencil icon. Creates a new session and navigates to `/`.
  2. **Projects** — Link with folder icon. Navigates to `/projects`.
  3. **Chats** — Link with messages icon. Navigates to `/sessions`.
- Below the main items, a **Recent Sessions** section SHALL display up to 5 most recent sessions.
- The nav SHALL remain collapsible (icon-only mode) using the existing toggle mechanism.
- When collapsed, items SHALL show only icons; when expanded, icons + labels.

#### Scenario: New Session creates a fresh conversation

- **WHEN** the user clicks "New Session"
- **THEN** a new session SHALL be created via `POST /sessions` with the user's `org_id`
- **THEN** the browser SHALL navigate to `/`
- **THEN** ChatView SHALL render with empty message history and welcome state

#### Scenario: Projects shows project grid

- **WHEN** the user clicks "Projects"
- **THEN** the browser SHALL navigate to `/projects`
- **THEN** the content area SHALL render the project grid (existing OrgView component)

#### Scenario: Chats shows session list

- **WHEN** the user clicks "Chats"
- **THEN** the browser SHALL navigate to `/sessions`
- **THEN** the content area SHALL render the SessionList component

---

### Requirement: Recent Sessions in Nav

The nav sidebar SHALL display up to 5 most recent sessions below the main navigation items.

- Sessions SHALL be fetched via `GET /sessions?org_id={orgId}&limit=5`.
- Each session item SHALL display:
  - The session title (if set) or first message text (truncated to ~40 characters).
  - A relative timestamp (e.g., "2m ago", "yesterday").
- Clicking a session item SHALL navigate to `/chat/:sessionId`.
- The list SHALL update when a new session is created or a message is sent (via query invalidation).
- When the nav is collapsed, recent sessions SHALL be hidden (only main nav icons visible).

#### Scenario: Recent session loads in ChatView

- **GIVEN** the nav shows a recent session titled "Sales analysis"
- **WHEN** the user clicks "Sales analysis"
- **THEN** the browser SHALL navigate to `/chat/{sessionId}`
- **THEN** ChatView SHALL load with that session's message history

#### Scenario: New message updates recent sessions list

- **GIVEN** the user sends a message in session A
- **THEN** session A SHALL move to the top of the recent sessions list
- **THEN** the timestamp SHALL update to "just now"

---

### Requirement: Active Route Highlighting

The nav SHALL visually indicate which section is currently active.

- "New Session" / recent sessions SHALL be highlighted when on `/` or `/chat/:sessionId`.
- "Projects" SHALL be highlighted when on `/projects` or `/projects/:projectId`.
- "Chats" SHALL be highlighted when on `/sessions`.
- No nav item is highlighted when on `/table/:datasetId` (the user arrived via project navigation, not nav).

#### Scenario: Highlighting on ChatView

- **GIVEN** the user is on `/chat/abc-123`
- **THEN** the corresponding recent session item (if visible) SHALL have an active highlight
