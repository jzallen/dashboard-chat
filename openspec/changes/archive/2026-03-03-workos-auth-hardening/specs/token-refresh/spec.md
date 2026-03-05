## MODIFIED Requirements

### Requirement: Proactive background token refresh timer
The frontend AuthProvider SHALL run a timer that fires at 80% of the access token TTL and calls `POST /api/auth/refresh` to obtain new tokens before the current token expires. The timer SHALL be skipped entirely in dev mode.

#### Scenario: Timer fires at 80% TTL
- **WHEN** a token is issued with `expires_in` of 300 seconds
- **THEN** the refresh timer SHALL fire at 240 seconds (300 * 0.8)
- **AND** the minimum delay SHALL be 10 seconds (even for very short TTLs)
- **AND** the timer SHALL call `POST /api/auth/refresh` with the stored refresh token

#### Scenario: Successful proactive refresh
- **WHEN** the proactive refresh timer fires and the refresh call succeeds
- **THEN** the new tokens SHALL be stored in localStorage and AuthState
- **AND** the timer SHALL be reset with the new `expires_in` value
- **AND** the user SHALL see no UI change (no spinner, modal, navigation, or layout shift)

#### Scenario: Proactive refresh failure with escalating retry
- **WHEN** the proactive refresh timer fires and the refresh call fails
- **THEN** the system SHALL retry up to 3 times with escalating delays: 30 seconds, then 60 seconds
- **AND** if any retry succeeds, tokens SHALL be updated and the timer reset
- **AND** if all 3 retries fail, the system SHALL log a warning and stop retrying
- **AND** the user SHALL NOT be force-logged-out (the 401 interceptor handles expiry on next API call)

#### Scenario: Timer skipped in dev mode
- **WHEN** `VITE_AUTH_MODE` is `"dev"`
- **THEN** the proactive refresh timer SHALL NOT be scheduled
- **AND** no `POST /api/auth/refresh` calls SHALL be made proactively

#### Scenario: Timer cleanup on unmount
- **WHEN** the AuthProvider unmounts or the user logs out
- **THEN** the refresh timer SHALL be cleared

#### Scenario: Refresh cycle repeats indefinitely
- **WHEN** a successful refresh occurs
- **THEN** a new timer SHALL be set for 80% of the new token's TTL
- **AND** the cycle SHALL continue as long as the session is valid

### Requirement: 401 interceptor with coalesced refresh and request replay
The frontend API layer SHALL intercept 401 responses, attempt a silent token refresh, and replay the failed request. Concurrent 401s SHALL be coalesced into a single refresh call.

#### Scenario: Single 401 triggers refresh and replay
- **WHEN** an API call returns 401 and a refresh token is available
- **THEN** the interceptor SHALL call `POST /api/auth/refresh`
- **AND** on success, replay the original request with the new access token
- **AND** return the replayed response to the caller transparently

#### Scenario: Concurrent 401s coalesced into single refresh
- **WHEN** multiple API calls return 401 simultaneously
- **THEN** only one refresh call SHALL be made
- **AND** all failed requests SHALL be queued and replayed after the refresh completes
- **AND** all replayed requests SHALL use the same new access token

#### Scenario: Refresh failure triggers hard logout
- **WHEN** a 401 triggers a refresh and the refresh call fails (after retry)
- **THEN** the system SHALL clear all auth tokens from localStorage
- **AND** redirect to `/login`

#### Scenario: Refresh retry uses 12-second delay
- **WHEN** the first refresh attempt fails
- **THEN** the system SHALL wait 12 seconds before retrying
- **AND** 12 seconds SHALL apply to both 429 and non-429 failures (no differentiation)
- **AND** this delay SHALL exceed the backend rate limiter's 10-second window

#### Scenario: No infinite retry loop
- **WHEN** a 401 triggers a refresh, and the replayed request also returns 401
- **THEN** the interceptor SHALL NOT attempt another refresh
- **AND** the system SHALL proceed to hard logout

#### Scenario: No refresh token available on 401
- **WHEN** an API call returns 401 and no refresh token exists in localStorage
- **THEN** the system SHALL immediately clear tokens and redirect to `/login`
