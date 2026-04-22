## Purpose

Describes how the frontend manages chat context — the per-project Stream channel, session identity as threads within that channel, and the entity context (dataset / view / report) attached to each session. It is the control surface for all chat state lifecycle decisions.

## Requirements

### Requirement: Stream Channel as Session Identity

ChatContext SHALL use Stream threads within a project memory channel as the session identity. Sessions are threads, not top-level channels.

- One Stream channel per project with ID format `proj_{compactOrgId}_{compactProjectId}`.
- Sessions are threads within the project channel.
- `createSession(projectId)` SHALL call the backend API to create a session, receiving a `stream_thread_id`.
- `loadSession(sessionId)` SHALL load the thread within the project's memory channel.
- Memory (channel) is fetched via `GET /api/projects/{project_id}/memory`, never created by the frontend.

#### Scenario: Session created as thread

- **WHEN** the user starts a new session in a project
- **THEN** the frontend SHALL call `POST /api/projects/{project_id}/sessions`
- **THEN** the frontend SHALL watch the returned thread within the project's Stream channel
- **THEN** the URL SHALL update to include the session ID

#### Scenario: Session resumed from URL

- **WHEN** the user navigates to a URL containing a session ID
- **THEN** the system SHALL load the session's thread within the project memory channel
- **THEN** message history SHALL be populated from the thread's messages
- **THEN** entity context SHALL be restored from session metadata

---

### Requirement: Dataset Context via Channel Custom Data

Entity context SHALL be tracked per-session (thread-level), while the parent memory channel holds project-level context.

- Project-level context (project ID, org ID) stored on the memory channel's custom data.
- Session-level context (active dataset/view) tracked in the frontend's session state and passed in chat requests.
- Dataset context can be set explicitly by the user or resolved by the agent via the SSE request protocol.

#### Scenario: Context persists within a session

- **GIVEN** the user selects dataset "Sales Q4" in a session
- **WHEN** the user sends subsequent messages in the same session
- **THEN** the dataset context SHALL be included in each chat request

#### Scenario: Context is independent across sessions

- **GIVEN** the user has session A with dataset "Sales Q4" and session B with no dataset
- **WHEN** the user switches from session A to session B
- **THEN** session B SHALL NOT inherit session A's dataset context

---

### Requirement: Session Reset (New Session)

Starting a new session SHALL create a new thread in the project memory, not a new channel.

- "New Session" SHALL call the backend to create a new session (thread) in the current project.
- The previous session remains accessible in the session list.
- In-memory messages SHALL be cleared and the UI SHALL switch to the new thread.

#### Scenario: New session in same project

- **WHEN** the user clicks "New Session" while in a project
- **THEN** a new session SHALL be created via `POST /api/projects/{project_id}/sessions`
- **AND** the chat UI SHALL clear and display the new empty session
- **AND** the previous session SHALL remain in the session list
