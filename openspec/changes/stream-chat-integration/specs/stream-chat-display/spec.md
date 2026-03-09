## ADDED Requirements

### Requirement: Stream SDK Chat Rendering

The Chat Panel SHALL use Stream React SDK primitives to render conversation history, replacing custom MessageBubble and message list components.

- The Chat Panel SHALL use `ChannelList` to display session history for the current project.
- The Chat Panel SHALL use `MessageList` to display messages within the active session.
- The Chat Panel SHALL use `MessageInput` for user text input.
- The Chat Panel SHALL NOT render custom message components — Stream's default text rendering is sufficient.
- Tool call metadata (`custom.tool_calls`) on assistant messages SHALL be ignored by the Chat Panel; the Table Panel owns tool call display.

#### Scenario: User sends a message via Stream MessageInput

- **WHEN** a user types a message and submits via Stream's `MessageInput`
- **THEN** the message SHALL appear immediately in the `MessageList` (optimistic update by Stream SDK)
- **AND** the frontend SHALL extract the message text, build the API payload with conversation history and entity context, and send POST /chat to the Worker via SSE

#### Scenario: Streaming text display during active turn

- **WHEN** the Worker is streaming an SSE response
- **THEN** the Chat Panel SHALL display an SSE overlay below the Stream message list showing the streaming assistant text
- **WHEN** the SSE turn completes and the assistant message is written to Stream
- **THEN** the SSE overlay SHALL be removed and the Stream message SHALL take its place

#### Scenario: Session switching

- **WHEN** a user selects a different session from the `ChannelList`
- **THEN** the `MessageList` SHALL update to show that session's conversation history
- **AND** the Table Panel SHALL update its operations log to reflect tool calls from the selected session

### Requirement: Read-Only Display for Frozen Sessions

- **WHEN** a user views a frozen session
- **THEN** the `MessageList` SHALL display all messages in read-only mode
- **THEN** the `MessageInput` SHALL be disabled or hidden
- **THEN** a visual indicator SHALL show that the session is frozen
