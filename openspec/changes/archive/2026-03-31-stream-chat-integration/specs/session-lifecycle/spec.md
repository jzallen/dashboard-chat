## ADDED Requirements

### Requirement: Project-Scoped Sessions

Sessions SHALL be scoped to projects, not datasets.

- A session (Stream channel) SHALL be associated with a single project.
- Switching the active dataset/view/report within a project SHALL NOT create a new session.
- The active entity context (dataset ID, entity type) SHALL be tracked separately from the session and sent with each POST /chat request.

#### Scenario: User switches dataset within same session

- **GIVEN** a user is in an active session chatting about Dataset A
- **WHEN** the user navigates to Dataset B within the same project
- **THEN** the session SHALL remain the same (same Stream channel)
- **AND** subsequent POST /chat requests SHALL include Dataset B's table schema
- **AND** the Worker SHALL generate tool calls appropriate for Dataset B

### Requirement: Session Freezing

Sessions SHALL freeze after 24 hours of inactivity, enforced by the application (not Stream).

- **WHEN** a user opens a session whose last message is older than 24 hours
- **THEN** the application SHALL mark the session as frozen by setting `frozenAt` in the Stream channel's custom data
- **THEN** the Chat Panel SHALL render the session as read-only (no message input)
- **THEN** the Table Panel operations log SHALL be read-only

#### Scenario: Frozen session prevents new messages

- **GIVEN** a session has been frozen (frozenAt is set)
- **WHEN** the user views the session
- **THEN** the MessageInput SHALL be disabled
- **THEN** a notice SHALL indicate the session is frozen and suggest creating a new session

#### Scenario: New session starts from current table state

- **GIVEN** all sessions for a project are frozen
- **WHEN** the user creates a new session
- **THEN** the table SHALL display data based on current active transforms and staging SQL
- **THEN** no tool calls from previous sessions SHALL be replayed
- **THEN** the new session starts with a clean operations log

### Requirement: Session Auto-Creation

- **WHEN** a user navigates to a project and no active (non-frozen) session exists
- **THEN** the system SHALL automatically create a new session (Stream channel)
- **THEN** the Chat Panel SHALL display the empty new session
