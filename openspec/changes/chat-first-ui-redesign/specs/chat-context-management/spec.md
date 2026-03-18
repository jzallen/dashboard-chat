## MODIFIED Requirements

### Requirement: Stream Channel as Session Identity

ChatContext SHALL use a Stream Chat channel as the primary session identifier. All session operations (create, resume, metadata updates) SHALL go through the Stream SDK, not custom REST endpoints.

**Current behavior:**
- `useSessionContext` creates channels scoped to `projectId` (`project_{pid}_{uuid}`).
- `useChatEngine` tracks `isActive` based on tool handler registration — chat is blocked without a dataset.
- `currentChannelRef` is set by external callers via `registerCurrentChannel()`.
- Session creation is tied to project load (auto-creates when project mounts).

**New behavior:**
- Channels SHALL be scoped to `orgId` with ID format `chat_{orgId}_{uuid}`.
- Channel custom data SHALL include: `orgId` (required), `projectId` (optional), `datasetId` (optional), `title` (optional), `createdAt`.
- `useSessionContext` SHALL be refactored to accept `orgId` instead of `projectId` and support explicit create/resume operations.
- `useChatEngine` SHALL own the channel lifecycle directly — no external `registerCurrentChannel()` calls needed.
- Chat SHALL work without a dataset — messages sent without `tableSchema` get conversational responses.

#### Scenario: Channel created on ChatView mount

- **WHEN** ChatView mounts at `/` (new session)
- **THEN** a new Stream channel SHALL be created: `client.channel("messaging", "chat_{orgId}_{uuid}", { orgId, createdAt })`
- **THEN** the channel SHALL be watched (`channel.watch()`)
- **THEN** the URL SHALL update to `/chat/{channelId}` via `history.replaceState` (no push)
- **THEN** ChatContext SHALL store the channel reference for message operations

#### Scenario: Channel resumed from URL

- **WHEN** the user navigates to `/chat/{channelId}`
- **THEN** the system SHALL call `client.channel("messaging", channelId).watch()`
- **THEN** message history SHALL be populated from `channel.state.messages`
- **THEN** dataset context SHALL be restored from `channel.data.datasetId` (if set)

---

### Requirement: Decouple Chat from Dataset Registration

ChatContext SHALL no longer require a tool handler to be registered before accepting messages. Chat works in two modes: conversational (no dataset) and operational (dataset mounted).

**Current behavior:**
- `submitText()` gates on `toolHandlerRef.current !== null` — messages are silently dropped without a tool handler.
- `DatasetDetail` calls `registerToolHandler()`, `registerDatasetId()`, and `registerTableSchema()` on mount.
- These refs are cleared when DatasetDetail unmounts (navigating away from dataset view).

**New behavior:**
- `submitText()` SHALL send messages regardless of tool handler presence.
- When `tableSchema` is null, messages SHALL be sent to the worker without schema context — the LLM responds conversationally.
- When tool calls are returned but no `toolHandler` is registered, the system SHALL append a navigation prompt: "Navigate to the table view to execute this operation" with a link to `/table/{datasetId}`.
- `DatasetDetail` (or TableView equivalent) SHALL still register `toolHandler` and `tableSchema` on mount for tool execution.

#### Scenario: Chat without dataset context

- **GIVEN** the user is in ChatView with no dataset selected
- **WHEN** the user sends "hello, what can you do?"
- **THEN** the chat engine SHALL send the message to the worker WITHOUT `tableSchema`
- **THEN** the worker SHALL respond with general capabilities (no tool calls possible)

#### Scenario: Tool call without mounted table

- **GIVEN** the user is in ChatView with dataset "Sales Q4" as context (from prior TableView visit)
- **WHEN** the user sends "filter by region = West"
- **THEN** the chat engine SHALL send the message with `tableSchema` (if cached) or without
- **THEN** if tool calls are returned but `toolHandlerRef.current` is null
- **THEN** the system SHALL display: "Navigate to the table view to execute this operation" with a link to `/table/{datasetId}`

---

### Requirement: Dataset Context via Channel Custom Data

Dataset context SHALL be stored as Stream channel custom data, not in a separate persistence layer.

- Setting dataset context SHALL call `channel.updatePartial({ set: { datasetId: "ds-123" } })`.
- Clearing dataset context SHALL call `channel.updatePartial({ set: { datasetId: null } })`.
- Navigating to `/table/:datasetId` SHALL update the channel's `datasetId` custom data.
- Resuming a session SHALL restore dataset context from `channel.data.datasetId`.
- The input gutter SHALL read dataset context from channel custom data, not local state alone.

#### Scenario: Context persists across views

- **GIVEN** the user selects dataset "Sales Q4" via the inline picker in ChatView
- **THEN** `channel.updatePartial({ set: { datasetId: "ds-sales-q4" } })` SHALL be called
- **WHEN** the user navigates to `/projects` and then back to `/chat/{channelId}`
- **THEN** the input gutter SHALL display "Sales Q4" (restored from channel data)

---

### Requirement: Session Reset (New Session)

Clicking "New Session" in the nav SHALL create a fresh Stream channel and navigate to `/`.

- The current channel reference SHALL be cleared in ChatContext.
- In-memory messages SHALL be cleared.
- A new channel SHALL be created on the subsequent ChatView mount.
- The previous channel is NOT deleted — it remains accessible via `/chat/{channelId}` or the session list.
