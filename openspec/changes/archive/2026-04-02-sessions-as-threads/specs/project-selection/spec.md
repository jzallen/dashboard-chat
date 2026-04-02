## ADDED Requirements

### Requirement: Project selection as chat entry point

Users SHALL select a project before accessing the chat interface. The project picker SHALL be the first interaction point.

#### Scenario: No project selected

- **WHEN** a user navigates to the chat area without a project selected
- **THEN** the system SHALL display the project picker
- **AND** chat input SHALL NOT be available until a project is selected

#### Scenario: Project selected

- **WHEN** a user selects a project from the picker
- **THEN** the system SHALL resolve the project's memory via `GET /api/projects/{project_id}/memory`
- **AND** the system SHALL display the session list for that project
- **AND** the user SHALL be able to create a new session or resume an existing one

#### Scenario: Project switch

- **WHEN** a user switches to a different project
- **THEN** the session list SHALL update to show sessions for the new project
- **AND** any active session SHALL be deactivated (not deleted)
