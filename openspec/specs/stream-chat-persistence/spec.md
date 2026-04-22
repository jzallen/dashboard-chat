# stream-chat-persistence Specification

## Purpose
Defines how chat messages are persisted in Stream.io channels, replacing the previous Redis + S3 session storage with managed channel-based persistence.

## Requirements
### Requirement: Stream Channel as Session Storage

The system SHALL persist chat messages in Stream.io channels, replacing Redis + S3 session storage.

- Each chat session SHALL map to a Stream channel with ID format `project_{projectId}_{sessionId}`.
- The channel type SHALL be `messaging`.
- User messages SHALL be sent to the Stream channel via the Stream React SDK `channel.sendMessage()`.
- Assistant messages SHALL be written to the Stream channel after SSE turn completion, including the assistant's text content and tool call metadata in `custom.tool_calls`.
- Messages SHALL persist indefinitely in Stream (no TTL) until the account's retention policy applies.

#### Scenario: Message persists across page refresh

- **GIVEN** a user has sent messages in a chat session
- **WHEN** the user refreshes the page
- **THEN** the Chat Panel SHALL hydrate from the Stream channel and display all previous messages

#### Scenario: Assistant message includes tool call metadata

- **WHEN** an SSE turn completes with tool_calls
- **THEN** the frontend SHALL write an assistant message to the Stream channel with:
  - `text`: the assistant's text response
  - `user`: `{ id: "assistant" }`
  - `custom.tool_calls`: array of `{ name, args, result }` objects
- **THEN** the message payload (text + custom) SHALL be under 5 KB

### Requirement: Session Creation

The system SHALL create a new Stream channel when a user enters a project without an active (non-frozen) session.

#### Scenario: Project entry creates a new channel

- **GIVEN** a user opens a project and no active (non-frozen) session exists
- **WHEN** the Chat Panel mounts
- **THEN** the system SHALL create a new Stream channel for the session
- **AND** the channel SHALL be configured with custom data `{ projectId, createdAt, frozenAt: null }`

### Requirement: Session Listing

The Chat Panel SHALL present all sessions for the current project via Stream's `ChannelList`, ordered by recency and distinguishing frozen sessions.

#### Scenario: Channel list rendered for a project

- **WHEN** a user views the Chat Panel for a project
- **THEN** the system SHALL display a list of all channels for that project via Stream's `ChannelList`
- **AND** channels SHALL be sorted by last message timestamp (most recent first)
- **AND** frozen sessions SHALL be visually distinguished from active sessions
