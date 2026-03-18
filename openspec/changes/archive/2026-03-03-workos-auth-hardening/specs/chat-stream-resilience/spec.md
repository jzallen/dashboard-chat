## MODIFIED Requirements

### Requirement: Single retry on stream setup 401
If the SSE stream setup request (before any chunks arrive) returns 401, the system SHALL refresh the token and retry the stream connection once. If the retry also fails with 401, the system SHALL call `hardLogout()`.

#### Scenario: 401 during stream setup triggers retry
- **WHEN** the initial SSE fetch returns 401 (before any data chunks)
- **THEN** the system SHALL call the token refresh function
- **AND** retry the SSE fetch once with the new access token

#### Scenario: Retry succeeds after stream setup 401
- **WHEN** the retried SSE fetch succeeds
- **THEN** the chat stream SHALL proceed normally
- **AND** the user SHALL see the streamed response without interruption

#### Scenario: Retry fails after stream setup 401 triggers hard logout
- **WHEN** the retried SSE fetch also returns 401
- **THEN** the system SHALL call `hardLogout()` (clear localStorage, redirect to `/login`)
- **AND** the chat stream SHALL be aborted

#### Scenario: Refresh failure during stream 401 triggers hard logout
- **WHEN** the SSE fetch returns 401 and the token refresh itself fails
- **THEN** the system SHALL call `hardLogout()`

### Requirement: logTurn uses withAuthRetry for 401 recovery
The `logTurn()` function in `sessions.ts` SHALL use `withAuthRetry()` to handle 401 responses, consistent with other API calls.

#### Scenario: logTurn 401 triggers refresh and replay
- **WHEN** `logTurn()` receives a 401 response
- **THEN** it SHALL pass the response through `withAuthRetry(response, url, init)`
- **AND** `withAuthRetry` SHALL attempt token refresh and replay

#### Scenario: logTurn 401 after retry triggers hard logout
- **WHEN** `logTurn()` receives a 401 after the retry
- **THEN** `withAuthRetry` SHALL call `hardLogout()`

## UNMODIFIED (carried forward from token-refresh-flow)

### Requirement: Pre-stream token freshness check
Before initiating an SSE chat stream, the frontend SHALL check whether the access token expires within 60 seconds and proactively refresh if needed. (No changes from token-refresh-flow spec.)

### Requirement: Mid-stream 401 is a known limitation
Mid-stream token expiry SHALL NOT be handled in v1. (No changes from token-refresh-flow spec.)
