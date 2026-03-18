## MODIFIED Requirements

### Requirement: Entity Context Decoupled from Session

The active entity context (which dataset/view/report is selected) SHALL be independent of the chat session.

- Navigating to a different dataset/view/report SHALL update entity context without creating a new session or Stream channel.
- The `registerDatasetId()` function SHALL update entity context without resetting `sessionIdRef` (current behavior resets session on dataset change).
- The entity context SHALL include: `projectId`, `entityType` ("dataset" | "view" | "report"), `entityId`, and `tableSchema`.

#### Scenario: Entity context sent with each chat request

- **WHEN** the frontend sends POST /chat to the Worker
- **THEN** the request SHALL include the current entity's `tableSchema` (columns, row count, active filters, cleaning transforms)
- **THEN** the Worker SHALL use the table schema to generate appropriate system prompts and tool definitions
- **THEN** the session (Stream channel) SHALL remain the same regardless of which entity is active
