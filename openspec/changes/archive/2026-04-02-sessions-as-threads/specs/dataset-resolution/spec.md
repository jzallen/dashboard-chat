## ADDED Requirements

### Requirement: Agent requests dataset resolution via SSE

The agent SHALL use the extended SSE protocol (`r:` prefix) to request dataset resolution from the frontend when the user references a dataset by name without an active schema context.

#### Scenario: Agent requests dataset by name

- **WHEN** the user sends "show me the patients table" and no dataset schema is in context
- **THEN** the agent SHALL emit `r:{"type":"resolve_dataset","params":{"name":"patients"}}`
- **AND** the agent SHALL emit `d:{"finishReason":"request"}` to terminate the stream
- **AND** the frontend SHALL fulfill the request before re-submitting

#### Scenario: Agent has schema context already

- **WHEN** the user sends a table operation and the request already includes `tableSchema`
- **THEN** the agent SHALL NOT emit a resolve request
- **AND** the agent SHALL process the operation directly

---

### Requirement: Dataset search endpoint

The backend SHALL expose `GET /api/projects/{project_id}/datasets/search?q={name}` to search datasets by name within a project.

#### Scenario: Single match found

- **WHEN** the search query matches exactly one dataset name
- **THEN** the system SHALL return that dataset with its schema summary

#### Scenario: Multiple matches found

- **WHEN** the search query matches multiple dataset names
- **THEN** the system SHALL return all matches
- **AND** the agent SHALL present the options to the user for clarification

#### Scenario: No matches found

- **WHEN** the search query matches no datasets in the project
- **THEN** the system SHALL return an empty list

#### Scenario: Search respects org scoping

- **WHEN** a user searches datasets in a project belonging to a different org
- **THEN** the system SHALL return 403 or 404

---

### Requirement: Frontend fulfills resolve_dataset requests

The frontend SHALL handle `r:` messages with type `resolve_dataset` by fetching the dataset from the backend API and re-submitting the chat request.

#### Scenario: Single dataset resolved

- **WHEN** the frontend receives `r:{"type":"resolve_dataset","params":{"name":"patients"}}`
- **THEN** the frontend SHALL call `GET /api/projects/{id}/datasets/search?q=patients`
- **AND** if exactly one match is returned, the frontend SHALL re-submit the chat request with the dataset's schema included
- **AND** the re-submitted request SHALL include the `thread_id` for context continuity

#### Scenario: Multiple datasets matched

- **WHEN** the dataset search returns multiple matches
- **THEN** the frontend SHALL present a picker to the user
- **AND** after the user selects a dataset, the frontend SHALL re-submit with the selected dataset's schema

#### Scenario: No dataset found

- **WHEN** the dataset search returns no matches
- **THEN** the frontend SHALL re-submit the chat request with an error payload
- **AND** the agent SHALL respond to the user indicating the dataset was not found

#### Scenario: Frontend request fulfillment fails

- **WHEN** the frontend cannot fulfill the `r:` request (network error, timeout)
- **THEN** the frontend SHALL re-submit with an error payload
- **AND** the agent SHALL respond gracefully to the user
