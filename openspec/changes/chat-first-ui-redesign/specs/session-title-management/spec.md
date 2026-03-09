## ADDED Requirements

### Requirement: Auto-Set Session Title from First Message

When the user sends the first message in a new session, the system SHALL automatically set the session title to the first message text.

- The title SHALL be the first message truncated to 100 characters.
- The title SHALL be set via `PATCH /sessions/:id` with `title` field.
- The title update SHALL occur after the first message is successfully sent (fire-and-forget, no blocking).
- The recent sessions list in the nav SHALL update to reflect the new title.

#### Scenario: First message sets title

- **GIVEN** a new session with no title
- **WHEN** the user sends "Show me all customers with revenue over $10,000"
- **THEN** the session title SHALL be set to "Show me all customers with revenue over $10,000"
- **THEN** the recent sessions nav item SHALL display this title (truncated to fit)

#### Scenario: Long first message truncated

- **GIVEN** a new session with no title
- **WHEN** the user sends a message longer than 100 characters
- **THEN** the session title SHALL be set to the first 100 characters of the message

#### Scenario: Subsequent messages do not change title

- **GIVEN** a session with title already set from the first message
- **WHEN** the user sends additional messages
- **THEN** the title SHALL NOT be updated automatically

---

### Requirement: Editable Session Titles

Users SHALL be able to edit session titles from the nav sidebar and the Chats view.

- In the nav sidebar, hovering over a recent session SHALL reveal an edit affordance (pencil icon or inline edit on double-click).
- In the SessionList view (`/sessions`), each session row SHALL have an editable title field.
- Editing SHALL use `PATCH /sessions/:id` with the new `title` value.
- The title update SHALL be optimistic — the UI updates immediately, reverting on error.

#### Scenario: Edit title in nav

- **GIVEN** the nav shows a recent session titled "Show me all customers..."
- **WHEN** the user double-clicks the title text
- **THEN** the title SHALL become an editable text field
- **WHEN** the user types "Customer Revenue Analysis" and presses Enter
- **THEN** the title SHALL update to "Customer Revenue Analysis"
- **THEN** a PATCH request SHALL be sent to update the session

#### Scenario: Edit title in session list

- **GIVEN** the user is on `/sessions`
- **WHEN** the user clicks the edit icon next to a session title
- **THEN** the title SHALL become editable inline
- **WHEN** the user changes the title and confirms
- **THEN** the title SHALL update optimistically

---

### Requirement: Session List Page

The system SHALL provide a SessionList page at `/sessions` showing all org-scoped sessions.

- Sessions SHALL be fetched via `GET /sessions?org_id={orgId}` (no limit, paginated if needed).
- Sessions SHALL be sorted by most recent first (the worker API returns them sorted by timestamp).
- Each session row SHALL display: title (or first message preview), relative timestamp, dataset context (if any).
- Clicking a session row SHALL navigate to `/chat/:sessionId`.

#### Scenario: Session list displays all sessions

- **GIVEN** the user has 12 sessions across various datasets
- **WHEN** the user navigates to `/sessions`
- **THEN** all 12 sessions SHALL be listed, sorted by most recent first
- **THEN** each row SHALL show title, timestamp, and dataset name (if set)

#### Scenario: Click session navigates to ChatView

- **GIVEN** the session list shows session "Customer Analysis" with ID `abc-123`
- **WHEN** the user clicks the row
- **THEN** the browser SHALL navigate to `/chat/abc-123`
