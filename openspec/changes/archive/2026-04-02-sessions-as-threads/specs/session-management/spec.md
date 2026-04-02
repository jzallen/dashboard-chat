## ADDED Requirements

### Requirement: Create session as Stream thread

The system SHALL create sessions via `POST /api/projects/{project_id}/sessions`. Each session SHALL be backed by a Stream thread within the project's memory channel.

#### Scenario: Session created successfully

- **WHEN** an authenticated user creates a session for a project they have access to
- **THEN** the system SHALL send a root message to the project's Stream channel (creating a thread)
- **AND** a `sessions` row SHALL be inserted with `stream_thread_id` set to the root message ID
- **AND** the `owner_id` SHALL be set to the authenticated user's ID
- **AND** the `org_id` SHALL be set to the user's org ID
- **AND** the response SHALL return the session metadata with status 201

#### Scenario: Session creation requires valid project

- **WHEN** a user attempts to create a session for a nonexistent project
- **THEN** the system SHALL return 404

#### Scenario: Session creation respects org scoping

- **WHEN** a user in org A attempts to create a session for a project in org B
- **THEN** the system SHALL return 403 or 404

---

### Requirement: List sessions within a project

The system SHALL expose `GET /api/projects/{project_id}/sessions` to list sessions for a project, ordered by `last_active_at` descending with cursor-based pagination.

#### Scenario: Sessions listed for project

- **WHEN** a user requests sessions for a project with 5 sessions
- **THEN** the system SHALL return all 5 sessions ordered by most recently active first
- **AND** each session SHALL include `id`, `title`, `owner_id`, `created_at`, and `last_active_at`

#### Scenario: Pagination with cursor

- **WHEN** a user requests sessions with `page_size=2`
- **THEN** the system SHALL return 2 sessions and a `next_cursor`
- **WHEN** the user requests with the returned cursor
- **THEN** the system SHALL return the next page of sessions

#### Scenario: Empty project returns empty list

- **WHEN** a user requests sessions for a project with no sessions
- **THEN** the system SHALL return an empty list with `has_more: false`

---

### Requirement: Update session metadata

The system SHALL expose `PATCH /api/projects/{project_id}/sessions/{session_id}` to update session title and `last_active_at`.

#### Scenario: Owner updates session title

- **WHEN** the session owner sends a PATCH with `{"title": "New Title"}`
- **THEN** the system SHALL update the session title
- **AND** the response SHALL return the updated session

#### Scenario: Title set from first message

- **WHEN** a session has no title and the first user message is sent
- **THEN** the system SHALL set the title to the first 100 characters of the message content

#### Scenario: Non-owner cannot update title

- **WHEN** a user who is not the session owner attempts to update the title
- **THEN** the system SHALL return 403

---

### Requirement: Sessions persist indefinitely

Sessions SHALL have no expiration, freezing, or inactivity timeout. Users SHALL be able to revisit any session at any time.

#### Scenario: Old session remains accessible

- **WHEN** a session has had no activity for 30 days
- **THEN** the session SHALL still appear in the session list
- **AND** the user SHALL be able to load and continue the session

#### Scenario: Multiple active sessions

- **WHEN** a user has 10 sessions in a project
- **THEN** all 10 sessions SHALL be active and accessible simultaneously
