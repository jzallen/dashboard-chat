# activity-detection Specification

## Purpose
TBD - created by archiving change token-refresh-session-decouple. Update Purpose after archive.
## Requirements
### Requirement: Debounced activity timestamp persistence
The system SHALL track user activity by writing `Date.now()` to `localStorage['last_activity_ts']` on mousedown, keydown, scroll, and touchstart events. The write MUST be debounced so that at most one write occurs per 5 minutes, preventing excessive localStorage I/O during normal user interaction.

#### Scenario: First interaction writes immediately
- **WHEN** a user performs a mousedown event and no `last_activity_ts` exists in localStorage
- **THEN** the system SHALL write the current timestamp to `localStorage['last_activity_ts']` immediately

#### Scenario: Subsequent interactions within 5 minutes are debounced
- **WHEN** a user performs a keydown event within 5 minutes of the last `last_activity_ts` write
- **THEN** the system SHALL NOT write to localStorage (the existing timestamp remains)

#### Scenario: Interaction after 5-minute debounce window writes new timestamp
- **WHEN** a user performs a scroll event and more than 5 minutes have elapsed since the last `last_activity_ts` value
- **THEN** the system SHALL write the current `Date.now()` to `localStorage['last_activity_ts']`

#### Scenario: Activity tracking only runs when authenticated
- **WHEN** the user is not authenticated
- **THEN** the system SHALL NOT register activity event listeners or write to `last_activity_ts`

### Requirement: Inactivity detection with 20-minute threshold
The system SHALL check user inactivity every 60 seconds by comparing `Date.now()` against the `last_activity_ts` value in localStorage. If the difference exceeds 20 minutes (1,200,000 ms), the system SHALL display the ActivityCheckModal.

#### Scenario: User active within 20 minutes
- **WHEN** the 60-second inactivity check fires and `Date.now() - last_activity_ts` is less than 20 minutes
- **THEN** the system SHALL NOT show the ActivityCheckModal

#### Scenario: User inactive for 20 minutes
- **WHEN** the 60-second inactivity check fires and `Date.now() - last_activity_ts` is greater than or equal to 20 minutes
- **THEN** the system SHALL display the ActivityCheckModal with "Are you still there?" prompt

#### Scenario: User clicks Continue on the modal
- **WHEN** the user clicks the "Continue" button on the ActivityCheckModal
- **THEN** the system SHALL write the current timestamp to `last_activity_ts`, dismiss the modal, and resume normal inactivity checking

### Requirement: Cross-tab activity synchronization via StorageEvent
The system SHALL listen for `StorageEvent` on the `last_activity_ts` key so that user activity in any tab resets the inactivity timer in all tabs. This prevents the modal from appearing in a background tab when the user is active in a foreground tab.

#### Scenario: Activity in another tab updates local inactivity state
- **WHEN** another tab writes a new value to `localStorage['last_activity_ts']`
- **THEN** the current tab SHALL receive a `StorageEvent` and use the new timestamp for its next inactivity check, without showing the modal prematurely

#### Scenario: Logout in another tab triggers local cleanup
- **WHEN** another tab removes the `auth_token` key from localStorage (indicating logout)
- **THEN** the current tab SHALL detect this via `StorageEvent` and clear its own auth state (effectively logging out)

### Requirement: ActivityCheckModal 10-minute auto-logout timeout
The ActivityCheckModal SHALL automatically trigger logout if the user does not respond within 10 minutes (600,000 ms) of the modal appearing. This replaces the previous 5-minute timeout.

#### Scenario: No response within 10 minutes triggers auto-logout
- **WHEN** the ActivityCheckModal is displayed and the user does not click "Continue" or "Log Out" within 10 minutes
- **THEN** the system SHALL call the logout function and redirect to `/login`

#### Scenario: Response before 10 minutes prevents auto-logout
- **WHEN** the ActivityCheckModal is displayed and the user clicks "Continue" at 9 minutes and 59 seconds
- **THEN** the system SHALL dismiss the modal, reset the activity timestamp, and NOT trigger auto-logout

### Requirement: Token refresh timer decoupled from logout
The proactive token refresh timer SHALL NOT trigger logout on failure. When the refresh attempt fails, the timer SHALL schedule a retry at 30 seconds, then a second retry at 60 seconds. Only after both retries fail SHALL the timer stop retrying (but still not call logout). Logout MUST only be triggered by the 401 interceptor (when a real API call fails and refresh cannot recover) or the activity detection layer (inactivity modal timeout).

#### Scenario: Refresh failure triggers retry at 30 seconds
- **WHEN** the proactive refresh timer fires at 80% TTL and `ensureFreshToken()` returns null
- **THEN** the system SHALL schedule a retry after 30 seconds and SHALL NOT call logout

#### Scenario: First retry fails, second retry at 60 seconds
- **WHEN** the 30-second retry also fails (ensureFreshToken returns null)
- **THEN** the system SHALL schedule a final retry after 60 seconds and SHALL NOT call logout

#### Scenario: All retries exhausted, no logout triggered
- **WHEN** all three refresh attempts (initial + 2 retries) fail
- **THEN** the system SHALL stop retrying but SHALL NOT call logout. The user continues working with the existing token until a 401 from a real API call triggers the interceptor.

#### Scenario: Retry succeeds after initial failure
- **WHEN** the initial refresh fails but the 30-second retry succeeds
- **THEN** the system SHALL update the token, reset the refresh timer with the new TTL, and resume normal refresh cycling

### Requirement: Stale token capture fix in doRefresh
The `doRefresh()` function SHALL accept the refresh token as a parameter on the first attempt rather than re-reading it from localStorage. On retry, it SHALL re-read from localStorage to pick up tokens that another tab may have refreshed. This prevents sending a consumed single-use WorkOS token on retry after the first attempt partially succeeded (token consumed at WorkOS but response failed).

#### Scenario: First attempt uses captured token
- **WHEN** `ensureFreshToken()` initiates a refresh
- **THEN** the first `doRefresh()` call SHALL use the refresh token captured at function entry, not a fresh read from localStorage

#### Scenario: Retry reads fresh token from localStorage
- **WHEN** the first refresh attempt fails and a retry is scheduled
- **THEN** the retry `doRefresh()` call SHALL re-read the refresh token from localStorage

### Requirement: 429 rate-limit handling in refresh
The refresh logic SHALL detect a 429 response status from the `POST /api/auth/refresh` endpoint and wait 12 seconds before retrying (clearing the backend's 10-second rate-limit window). Non-429 failures SHALL continue using the existing 5-second retry delay.

#### Scenario: 429 response triggers 12-second backoff
- **WHEN** the refresh call receives a 429 response
- **THEN** the system SHALL wait 12 seconds before the retry attempt

#### Scenario: Non-429 failure uses standard 5-second delay
- **WHEN** the refresh call fails with a non-429 error (e.g., 500, network error)
- **THEN** the system SHALL wait 5 seconds before the retry attempt

### Requirement: Extended coalescing window
The `refreshPromise` variable SHALL be cleared 500ms after the refresh promise settles (rather than immediately in `.finally()`). This prevents a race condition where a concurrent caller reads a stale token and starts a new refresh immediately after the promise resolves.

#### Scenario: Concurrent caller within 500ms joins existing promise
- **WHEN** a refresh promise has just settled and another caller invokes `ensureFreshToken()` within 500ms
- **THEN** the caller SHALL receive the result of the already-settled promise (coalesced) rather than starting a new refresh

### Requirement: Freshness guard skips redundant refresh
The `ensureFreshToken()` function SHALL check the current token's expiry before initiating a refresh. If the token has more than 60 seconds of validity remaining, the function SHALL return the current token from localStorage without making a network call.

#### Scenario: Token with >60s remaining skips refresh
- **WHEN** `ensureFreshToken()` is called and `auth_token_expires_at - Date.now() > 60000`
- **THEN** the function SHALL return the current `auth_token` from localStorage without calling the refresh endpoint

#### Scenario: Token with <=60s remaining proceeds with refresh
- **WHEN** `ensureFreshToken()` is called and `auth_token_expires_at - Date.now() <= 60000`
- **THEN** the function SHALL proceed with the normal refresh flow

### Requirement: Diagnostic logging in refresh path
The refresh logic SHALL log diagnostic messages at appropriate levels throughout the refresh lifecycle. All log messages SHALL be prefixed with `[auth]` for filterability in the browser console.

#### Scenario: Refresh attempt start logged
- **WHEN** `ensureFreshToken()` begins a refresh attempt
- **THEN** the system SHALL log `console.debug("[auth] Starting token refresh")`

#### Scenario: Refresh success logged
- **WHEN** a refresh call succeeds
- **THEN** the system SHALL log `console.debug("[auth] Token refresh successful, expires_in: <value>")`

#### Scenario: First failure logged as warning
- **WHEN** the first refresh attempt fails
- **THEN** the system SHALL log `console.warn("[auth] First refresh attempt failed:", <error>)`

#### Scenario: Final failure logged as error
- **WHEN** the retry also fails
- **THEN** the system SHALL log `console.error("[auth] Token refresh failed after retry:", <error>)`

#### Scenario: No refresh token available logged
- **WHEN** `ensureFreshToken()` is called with no refresh token in localStorage
- **THEN** the system SHALL log `console.warn("[auth] No refresh token available")`

