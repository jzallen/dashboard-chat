## MODIFIED Requirements

### Requirement: Decouple ChatContext from DatasetView

The ChatContext (chat engine state) SHALL no longer depend on DatasetView mounting to register tool handlers and table schema. Instead, context SHALL be managed at the session level.

**Current behavior:**
- `DatasetDetail` calls `registerToolHandler()`, `registerDatasetId()`, and `registerTableSchema()` on mount.
- These refs are cleared when DatasetDetail unmounts (navigating away from dataset view).
- Chat only works when a dataset is actively displayed.

**New behavior:**
- ChatContext SHALL maintain session-level state: `sessionId`, `datasetId`, `tableSchema`, `toolHandler`.
- When in ChatView without a dataset, `tableSchema` and `toolHandler` SHALL be null — the chat engine skips tool execution and sends messages without schema context.
- When in TableView, `DatasetDetail` (or equivalent) SHALL still register tool handler and schema, but via the session-level context rather than direct ref registration.
- When navigating from TableView to ChatView, the dataset context (`datasetId`) SHALL persist, but `toolHandler` and `tableSchema` SHALL be cleared (tool execution requires the table to be mounted).

#### Scenario: Chat without dataset context

- **GIVEN** the user is in ChatView with no dataset selected
- **WHEN** the user sends "hello, what can you do?"
- **THEN** the chat engine SHALL send the message to the worker WITHOUT tableSchema
- **THEN** the worker SHALL respond with general capabilities (no tool calls possible)

#### Scenario: Chat with dataset context but not in TableView

- **GIVEN** the user is in ChatView with dataset "Sales Q4" as context
- **WHEN** the user sends "filter by region = West"
- **THEN** the chat engine SHALL detect that no toolHandler is registered (table not mounted)
- **THEN** the system SHALL display a message: "Navigate to the table view to execute table operations" or auto-navigate to `/table/:datasetId`

---

### Requirement: Session-Primary Tracking

ChatContext SHALL track the active session as its primary identifier, with dataset as secondary context.

**Current behavior:**
- `sessionIdRef`, `projectIdRef`, `datasetIdRef` are independent refs.
- Session is created lazily on first message, scoped to the current dataset.

**New behavior:**
- Session SHALL be created eagerly when ChatView or TableView mounts (via `POST /sessions`).
- `sessionId` SHALL be the primary tracking identifier.
- `datasetId` SHALL be stored on the session metadata (worker-side) and in local state.
- When resuming a session (`/chat/:sessionId`), the `datasetId` SHALL be read from session metadata.
- The `logChatTurn` function SHALL continue to pass `sessionId`, `projectId`, and `datasetId` for audit logging.

#### Scenario: Session created on ChatView mount

- **WHEN** ChatView mounts (new session at `/`)
- **THEN** a `POST /sessions` request SHALL be sent with `org_id`
- **THEN** the returned `session_id` SHALL be stored in ChatContext
- **THEN** the URL SHALL update to `/chat/:sessionId` (replace, not push) after session creation

#### Scenario: Session resumed from URL

- **WHEN** the user navigates to `/chat/abc-123`
- **THEN** a `GET /sessions/abc-123` request SHALL be sent
- **THEN** the session's `dataset_id` (if set) SHALL be restored in ChatContext
- **THEN** the session's turns SHALL be rendered as message history
