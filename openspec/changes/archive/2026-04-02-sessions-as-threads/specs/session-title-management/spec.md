## MODIFIED Requirements

### Requirement: Auto-Set Session Title from First Message

When the user sends the first message in a new session, the system SHALL automatically set the session title via the backend API.

**Current behavior:**
- Title set via `channel.updatePartial({ set: { title: "..." } })` on Stream channel custom data.

**New behavior:**
- Title set via `PATCH /api/projects/{project_id}/sessions/{session_id}` with the title field.
- The `sessions` table is the authoritative source for session titles.
- The title SHALL be the first message truncated to 100 characters.

#### Scenario: First message sets title

- **GIVEN** a new session with no title
- **WHEN** the user sends "Show me all customers with revenue over $10,000"
- **THEN** the system SHALL call PATCH on the session with title "Show me all customers with revenue over $10,000"
- **AND** the session list SHALL update to reflect the new title

#### Scenario: Long first message truncated

- **GIVEN** a new session with no title
- **WHEN** the user sends a message longer than 100 characters
- **THEN** the title SHALL be set to the first 100 characters of the message

#### Scenario: Subsequent messages do not change title

- **GIVEN** a session with title already set (title is non-null)
- **WHEN** the user sends additional messages
- **THEN** the title SHALL NOT be updated automatically

---

### Requirement: Editable Session Titles

Users SHALL be able to edit session titles from the session list. Only the session owner SHALL be able to edit.

**Current behavior:**
- Any user can edit via `channel.updatePartial()`.

**New behavior:**
- Title edits go through `PATCH /api/projects/{project_id}/sessions/{session_id}`.
- Backend enforces ownership: only `owner_id` can update the title.

#### Scenario: Owner edits title

- **GIVEN** the session list shows a session owned by the current user
- **WHEN** the user edits the title inline
- **THEN** the system SHALL call PATCH with the new title
- **AND** the UI SHALL update optimistically, reverting on error

#### Scenario: Non-owner sees but cannot edit title

- **GIVEN** the session list shows a session owned by a different user
- **WHEN** the current user views the session
- **THEN** the title SHALL be displayed but the edit affordance SHALL NOT appear

---

### Requirement: Session List queries backend

The session list SHALL query the backend API instead of Stream's `queryChannels`.

**Current behavior:**
- Sessions fetched via `client.queryChannels({ type: "messaging", "custom.orgId": orgId })`.

**New behavior:**
- Sessions fetched via `GET /api/projects/{project_id}/sessions`.
- Each session row SHALL display: title, owner, relative timestamp from `last_active_at`.
- Clicking a session SHALL load the corresponding Stream thread.

#### Scenario: Session list displays project sessions

- **GIVEN** a project with 5 sessions
- **WHEN** the user views the session list
- **THEN** the system SHALL call `GET /api/projects/{project_id}/sessions`
- **AND** all 5 sessions SHALL be listed, sorted by most recently active first
- **AND** each row SHALL show title, owner, and relative timestamp

#### Scenario: Click session loads thread

- **GIVEN** the session list shows session "Customer Analysis"
- **WHEN** the user clicks the row
- **THEN** the system SHALL load the session's Stream thread within the project memory channel
- **AND** message history SHALL be populated from the thread
