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
- **THEN** the current channel reference SHALL be cleared in ChatContext
- **THEN** the browser SHALL navigate to `/`
- **THEN** ChatView SHALL mount, create a new Stream channel, and render welcome state

#### Scenario: Projects shows project grid

- **WHEN** the user clicks "Projects"
- **THEN** the browser SHALL navigate to `/projects`
- **THEN** the content area SHALL render the project grid (existing OrgView component)

#### Scenario: Chats shows session list

- **WHEN** the user clicks "Chats"
- **THEN** the browser SHALL navigate to `/sessions`
- **THEN** the content area SHALL render the SessionList component

---

### Requirement: Recent Sessions in Nav (Stream-Backed)

The nav sidebar SHALL display up to 5 most recent sessions below the main navigation items, powered by Stream's `queryChannels` API.

- Sessions SHALL be fetched via `client.queryChannels({ type: "messaging", "custom.orgId": orgId }, { last_message_at: -1 }, { limit: 5 })`.
- Each session item SHALL display:
  - The session title from `channel.data.title` (if set) or first message text (truncated to ~40 characters).
  - A relative timestamp from `channel.state.last_message_at` (e.g., "2m ago", "yesterday").
- Clicking a session item SHALL navigate to `/chat/{channelId}`.
- The list SHALL update in real-time via Stream's WebSocket connection — when a new message is sent in any channel, the list reorders automatically.
- When the nav is collapsed, recent sessions SHALL be hidden (only main nav icons visible).

#### Scenario: Recent session loads in ChatView

- **GIVEN** the nav shows a recent session titled "Sales analysis"
- **WHEN** the user clicks "Sales analysis"
- **THEN** the browser SHALL navigate to `/chat/{channelId}`
- **THEN** ChatView SHALL watch the channel and load message history

#### Scenario: New message updates recent sessions list

- **GIVEN** the user sends a message in session A
- **THEN** Stream's WebSocket SHALL deliver the channel update
- **THEN** session A SHALL move to the top of the recent sessions list
- **THEN** the timestamp SHALL update to "just now"

---

### Requirement: Active Route Highlighting

The nav SHALL visually indicate which section is currently active.

- "New Session" / recent sessions SHALL be highlighted when on `/` or `/chat/:channelId`.
- "Projects" SHALL be highlighted when on `/projects` or `/projects/:projectId`.
- "Chats" SHALL be highlighted when on `/sessions`.
- No nav item is highlighted when on `/table/:datasetId` (the user arrived via project navigation, not nav).

#### Scenario: Highlighting on ChatView

- **GIVEN** the user is on `/chat/abc-123`
- **THEN** the corresponding recent session item (if visible) SHALL have an active highlight
