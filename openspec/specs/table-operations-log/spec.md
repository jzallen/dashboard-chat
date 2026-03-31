# table-operations-log Specification

## Purpose
Provides an operations log in the Table Panel that displays tool calls executed in the current session, sourced from Stream channel messages with tool call metadata.

## Requirements
### Requirement: Operations Log in Table Panel

The Table Panel SHALL display an operations log showing tool calls executed in the current session.

- The Table Panel SHALL subscribe to the active Stream channel for `message.new` events.
- The Table Panel SHALL filter incoming messages for those with `custom.tool_calls` metadata.
- Each tool call SHALL be displayed as a log entry showing: tool name, key arguments, result, and timestamp.
- The operations log SHALL be ordered chronologically (oldest first).

#### Scenario: Tool call appears in operations log after execution

- **GIVEN** a user sends a chat message that triggers a tool call (e.g., "filter age > 25")
- **WHEN** the SSE turn completes and the assistant message (with tool call metadata) is written to Stream
- **THEN** the Table Panel SHALL detect the new message via Stream channel subscription
- **THEN** the operations log SHALL display: "filterTable — age > 25"

#### Scenario: Operations log hydrates on page refresh

- **GIVEN** an active session with previous tool calls
- **WHEN** the user refreshes the page
- **THEN** the Table Panel SHALL query the Stream channel for all messages
- **THEN** the Table Panel SHALL filter for messages with `custom.tool_calls`
- **THEN** the operations log SHALL display all previous tool calls from the session

#### Scenario: Operations log updates on session switch

- **WHEN** a user switches to a different session via the ChannelList
- **THEN** the operations log SHALL clear and repopulate with tool calls from the selected session

### Requirement: Live Tool Call Execution via SSE

- During an active turn, tool calls SHALL still execute immediately from the SSE response (not from Stream channel events).
- The Table Panel SHALL deduplicate tool calls that arrive via both SSE (immediate) and Stream (write-behind) using the `tool_call.id` field.
- SSE-delivered tool calls take priority for execution; Stream-delivered tool calls are display-only for the operations log.
