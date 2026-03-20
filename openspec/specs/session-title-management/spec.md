## ADDED Requirements

### Requirement: Auto-Set Session Title from First Message

When the user sends the first message in a new session, the system SHALL automatically set the session title via Stream channel custom data.

- The title SHALL be the first message truncated to 100 characters.
- The title SHALL be set via `channel.updatePartial({ set: { title: "..." } })`.
- The title update SHALL occur after the first message is successfully sent (fire-and-forget, no blocking).
- The recent sessions list in the nav SHALL update automatically via Stream's real-time WebSocket events.

#### Scenario: First message sets title

- **GIVEN** a new session (channel) with no title in custom data
- **WHEN** the user sends "Show me all customers with revenue over $10,000"
- **THEN** `channel.updatePartial({ set: { title: "Show me all customers with revenue over $10,000" } })` SHALL be called
- **THEN** the recent sessions nav item SHALL display this title (truncated to fit)

#### Scenario: Long first message truncated

- **GIVEN** a new session with no title
- **WHEN** the user sends a message longer than 100 characters
- **THEN** the title SHALL be set to the first 100 characters of the message

#### Scenario: Subsequent messages do not change title

- **GIVEN** a session with title already set (channel.data.title is non-null)
- **WHEN** the user sends additional messages
- **THEN** the title SHALL NOT be updated automatically

---

### Requirement: Editable Session Titles

Users SHALL be able to edit session titles from the nav sidebar and the Chats view.

- In the nav sidebar, hovering over a recent session SHALL reveal an edit affordance (pencil icon or inline edit on double-click).
- In the SessionList view (`/sessions`), each session row SHALL have an editable title field.
- Editing SHALL call `channel.updatePartial({ set: { title: "new title" } })`.
- The title update SHALL be optimistic — the UI updates immediately, reverting on error.
- Stream's real-time events SHALL propagate the title change to other open tabs/views.

#### Scenario: Edit title in nav

- **GIVEN** the nav shows a recent session titled "Show me all customers..."
- **WHEN** the user double-clicks the title text
- **THEN** the title SHALL become an editable text field
- **WHEN** the user types "Customer Revenue Analysis" and presses Enter
- **THEN** `channel.updatePartial({ set: { title: "Customer Revenue Analysis" } })` SHALL be called
- **THEN** the title SHALL update optimistically in the nav

#### Scenario: Edit title in session list

- **GIVEN** the user is on `/sessions`
- **WHEN** the user clicks the edit icon next to a session title
- **THEN** the title SHALL become editable inline
- **WHEN** the user changes the title and confirms
- **THEN** the title SHALL update optimistically

---

### Requirement: Session List Page (Stream-Backed)

The system SHALL provide a SessionList page at `/sessions` showing all org-scoped sessions via Stream's `queryChannels`.

- Sessions SHALL be fetched via `client.queryChannels({ type: "messaging", "custom.orgId": orgId }, { last_message_at: -1 }, { limit: 30 })` with pagination.
- Sessions SHALL be sorted by most recent first.
- Each session row SHALL display: title from `channel.data.title` (or first message preview), relative timestamp from `channel.state.last_message_at`, dataset name badge from `channel.data.datasetId` (if set, resolved via dataset API).
- Clicking a session row SHALL navigate to `/chat/{channelId}`.

#### Scenario: Session list displays all sessions

- **GIVEN** the user has 12 sessions across various datasets
- **WHEN** the user navigates to `/sessions`
- **THEN** all 12 sessions SHALL be listed, sorted by most recent first
- **THEN** each row SHALL show title, timestamp, and dataset name (if set)

#### Scenario: Click session navigates to ChatView

- **GIVEN** the session list shows session "Customer Analysis" with channel ID `chat_org001_abc123`
- **WHEN** the user clicks the row
- **THEN** the browser SHALL navigate to `/chat/chat_org001_abc123`
