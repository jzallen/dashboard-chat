## MODIFIED Requirements

### Requirement: Inactivity detection after 20 minutes
The frontend SHALL track the last user interaction (mousedown, keydown, scroll, touchstart) and trigger an activity check after 20 minutes of inactivity. Activity timestamps SHALL be debounced (updated at most once per 5 minutes) and stored in localStorage for cross-tab awareness.

#### Scenario: Activity timer starts on login
- **WHEN** the user logs in or the AuthProvider mounts with valid tokens
- **THEN** the inactivity tracking SHALL begin
- **AND** event listeners SHALL be registered for `mousedown`, `keydown`, `scroll`, `touchstart` on `document`
- **AND** listeners SHALL be passive (non-blocking)

#### Scenario: User interaction resets inactivity timestamp (debounced)
- **WHEN** the user performs any tracked interaction
- **THEN** the `last_activity_ts` in localStorage SHALL be updated to `Date.now()`
- **AND** updates SHALL be debounced to at most once per 5 minutes to reduce localStorage writes

#### Scenario: Modal appears after 20 minutes of no interaction
- **WHEN** 20 minutes elapse since the last tracked user interaction
- **THEN** the "Are you still there?" modal SHALL be displayed

#### Scenario: Inactivity check runs every 60 seconds
- **WHEN** the AuthProvider is mounted with valid tokens
- **THEN** a `setInterval` SHALL check `(Date.now() - last_activity_ts) >= 20 minutes` every 60 seconds

### Requirement: Activity check modal with continue and logout actions
The system SHALL display a non-blocking modal dialog with "Continue" and "Log Out" buttons when the inactivity timer fires. The modal SHALL have a 10-minute dismissal timeout.

#### Scenario: Modal displays correct content
- **WHEN** the inactivity timer fires
- **THEN** the modal SHALL display the text "Are you still there?"
- **AND** the modal SHALL have a "Continue" button and a "Log Out" button

#### Scenario: User clicks Continue
- **WHEN** the "Are you still there?" modal is displayed and the user clicks "Continue"
- **THEN** the modal SHALL close
- **AND** the inactivity timer SHALL reset
- **AND** the session SHALL continue without interruption

#### Scenario: User clicks Log Out
- **WHEN** the "Are you still there?" modal is displayed and the user clicks "Log Out"
- **THEN** the system SHALL call `logout()` (which triggers backend session revocation)

#### Scenario: 10-minute timeout with no response forces logout
- **WHEN** the modal has been displayed for 10 minutes (600,000 ms) without any button click
- **THEN** the system SHALL automatically call `logout()`

#### Scenario: Modal dismissal requires explicit button clicks only
- **WHEN** the modal is displayed
- **THEN** pressing keys, moving the mouse, or clicking outside the modal SHALL NOT dismiss it
- **AND** only clicking "Continue" or "Log Out" SHALL dismiss the modal

## UNMODIFIED (carried forward from token-refresh-flow)

### Requirement: Token refresh continues while modal is displayed
The background token refresh timer SHALL NOT be paused or blocked while the activity check modal is visible. (No changes from token-refresh-flow spec.)

### Requirement: ActivityCheckModal is accessible
The ActivityCheckModal component SHALL meet WCAG 2.1 AA accessibility requirements. (No changes from token-refresh-flow spec.)
