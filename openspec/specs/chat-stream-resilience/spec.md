# chat-stream-resilience Specification

## Purpose
TBD - created by archiving change token-refresh-flow. Update Purpose after archive.
## Requirements
### Requirement: Pre-stream token freshness check
Before initiating an SSE chat stream, the frontend SHALL check whether the access token expires within 60 seconds and proactively refresh if needed.

#### Scenario: Token is near expiry before stream
- **WHEN** the user sends a chat message and the access token expires within 60 seconds
- **THEN** the system SHALL refresh the token before opening the SSE connection
- **AND** the SSE stream SHALL be opened with the new access token in the Authorization header

#### Scenario: Token is fresh before stream
- **WHEN** the user sends a chat message and the access token will not expire for more than 60 seconds
- **THEN** the SSE stream SHALL be opened immediately with the current access token
- **AND** no refresh call SHALL be made

#### Scenario: Pre-stream refresh fails
- **WHEN** the user sends a chat message, the token is near expiry, and the refresh call fails
- **THEN** the system SHALL attempt to open the stream with the existing token
- **AND** if the stream setup returns 401, the 401 interceptor SHALL handle it

### Requirement: Single retry on stream setup 401
If the SSE stream setup request (before any chunks arrive) returns 401, the system SHALL refresh the token and retry the stream connection once.

#### Scenario: 401 during stream setup triggers retry
- **WHEN** the initial SSE fetch returns 401 (before any data chunks)
- **THEN** the system SHALL call the token refresh function
- **AND** retry the SSE fetch once with the new access token

#### Scenario: Retry succeeds after stream setup 401
- **WHEN** the retried SSE fetch succeeds
- **THEN** the chat stream SHALL proceed normally
- **AND** the user SHALL see the streamed response without interruption

#### Scenario: Retry fails after stream setup 401
- **WHEN** the retried SSE fetch also fails
- **THEN** the system SHALL display an error message in the chat
- **AND** the user SHALL NOT be redirected to login (the 401 interceptor handles that separately)

### Requirement: Mid-stream 401 is a known limitation
Mid-stream token expiry (after chunks have started arriving) SHALL NOT be handled in v1.

#### Scenario: Token expires during active stream
- **WHEN** the access token expires while an SSE stream is actively receiving chunks
- **THEN** the stream MAY fail
- **AND** the system SHALL NOT attempt mid-stream recovery
- **AND** this SHALL be documented as a known v1 limitation

