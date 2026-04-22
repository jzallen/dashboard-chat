## MODIFIED Requirements

### Requirement: Dataset Context via Channel Custom Data

Entity context SHALL be tracked per-session (thread-level), while the parent memory channel holds project-level context.

- Project-level context (project ID, org ID) stored on the memory channel's custom data.
- Session-level context (active dataset/view/report) tracked in the frontend's session state and passed in chat requests.
- Dataset context can be set explicitly by the user or resolved by the agent via the SSE request protocol.

#### Scenario: Context persists within a session

- **GIVEN** the user selects dataset "Sales Q4" in a session
- **WHEN** the user sends subsequent messages in the same session
- **THEN** the dataset context SHALL be included in each chat request

#### Scenario: Context is independent across sessions

- **GIVEN** the user has session A with dataset "Sales Q4" and session B with no dataset
- **WHEN** the user switches from session A to session B
- **THEN** session B SHALL NOT inherit session A's dataset context

#### Scenario: Report context persists within a session

- **GIVEN** the user is viewing report "Orders" in a session
- **WHEN** the user sends subsequent messages in the same session
- **THEN** the report context SHALL be included in each chat request with `contextType: "report"`
