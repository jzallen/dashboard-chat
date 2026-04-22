# chat-streaming Specification

## Purpose
Defines the SSE streaming flow with Stream.io write-behind persistence, where the Worker streams responses via SSE and the frontend writes completed turns to Stream channels after tool call execution.

## Requirements
### Requirement: SSE Streaming with Stream Write-Behind

The existing SSE streaming from Worker to frontend SHALL be preserved. After turn completion, the frontend SHALL write the completed turn to the active Stream channel.

- The Worker POST /chat endpoint SHALL remain unchanged (receives messages + tableSchema, streams via SSE).
- The frontend SHALL continue to use `readSSEStream()` to consume SSE events (content, tool_calls, done, error).
- Tool calls SHALL continue to execute client-side immediately on SSE "done" event.
- **NEW**: After tool call execution completes, the frontend SHALL write the assistant message to the Stream channel via `channel.sendMessage()`.

#### Scenario: Complete turn lifecycle

- **WHEN** a user submits a message
- **THEN** the frontend SHALL:
  1. Send the user message to Stream (`channel.sendMessage()`)
  2. Build the API payload from Stream channel history + current entity context
  3. POST /chat to the Worker (SSE)
  4. Display streaming text via SSE overlay
  5. On SSE "done", execute tool calls client-side
  6. Write assistant message to Stream with `custom.tool_calls` metadata
  7. Remove SSE overlay (Stream message takes its place)

### Requirement: Conversation History for Worker Context

The frontend SHALL build the Worker's message history from Stream channel messages (not from in-memory state). Each Stream message SHALL be mapped to the Worker's Message format: `{ role, content, tool_calls }`. The `user` field on Stream messages determines role mapping: `"assistant"` user → `role: "assistant"`, all others → `role: "user"`.

#### Scenario: History built from Stream channel

- **GIVEN** a Stream channel with a prior exchange of user and assistant messages
- **WHEN** the frontend prepares a Worker `/chat` request
- **THEN** the message history SHALL be read from `channel.state.messages` rather than any in-memory state
- **AND** each message SHALL be mapped to `{ role, content, tool_calls }` with role derived from the Stream `user` field (`"assistant"` user → `assistant`, otherwise → `user`)
