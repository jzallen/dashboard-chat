# activity-check Specification

## Purpose
TBD - created by archiving change token-refresh-flow. Update Purpose after archive.
## Requirements
### Requirement: Inactivity detection after 60 minutes
The frontend SHALL track the last user interaction (mousedown, keydown, scroll, touchstart) and trigger an activity check after 60 minutes of inactivity.

#### Scenario: Activity timer starts on login
- **WHEN** the user logs in or the AuthProvider mounts with valid tokens
- **THEN** the inactivity tracking SHALL begin
- **AND** event listeners SHALL be registered for `mousedown`, `keydown`, `scroll`, `touchstart` on `document`

#### Scenario: User interaction resets inactivity timestamp
- **WHEN** the user performs any tracked interaction (mousedown, keydown, scroll, touchstart)
- **THEN** the `lastActivity` timestamp SHALL be updated to `Date.now()`
- **AND** the 60-minute countdown SHALL reset

#### Scenario: Modal appears after 60 minutes of no interaction
- **WHEN** 60 minutes elapse since the last tracked user interaction
- **THEN** the "Are you still there?" modal SHALL be displayed

#### Scenario: Inactivity timer does not fire during active use
- **WHEN** the user interacts with the application at least once every 60 minutes
- **THEN** the inactivity modal SHALL never appear

### Requirement: Activity check modal with continue and logout actions
The system SHALL display a non-blocking modal dialog with "Continue" and "Log Out" buttons when the inactivity timer fires. The modal SHALL have a 5-minute dismissal timeout.

#### Scenario: Modal displays correct content
- **WHEN** the inactivity timer fires
- **THEN** the modal SHALL display the text "Are you still there?"
- **AND** the modal SHALL have a "Continue" button and a "Log Out" button

#### Scenario: User clicks Continue
- **WHEN** the "Are you still there?" modal is displayed and the user clicks "Continue"
- **THEN** the modal SHALL close
- **AND** the inactivity timer SHALL reset to 60 minutes from now
- **AND** the session SHALL continue without interruption

#### Scenario: User clicks Log Out
- **WHEN** the "Are you still there?" modal is displayed and the user clicks "Log Out"
- **THEN** the system SHALL call `logout()`
- **AND** the user SHALL be redirected to `/login`

#### Scenario: 5-minute timeout with no response forces logout
- **WHEN** the modal has been displayed for 5 minutes (300,000 ms) without any button click
- **THEN** the system SHALL automatically call `logout()`
- **AND** the user SHALL be redirected to `/login`

#### Scenario: Modal dismissal requires explicit button clicks only
- **WHEN** the modal is displayed
- **THEN** pressing keys, moving the mouse, or clicking outside the modal SHALL NOT dismiss it
- **AND** only clicking "Continue" or "Log Out" SHALL dismiss the modal

### Requirement: Token refresh continues while modal is displayed
The background token refresh timer SHALL NOT be paused or blocked while the activity check modal is visible.

#### Scenario: Refresh occurs during modal display
- **WHEN** the activity check modal is visible and the refresh timer fires
- **THEN** the token refresh SHALL proceed normally
- **AND** the new tokens SHALL be stored

### Requirement: ActivityCheckModal is accessible
The ActivityCheckModal component SHALL meet WCAG 2.1 AA accessibility requirements.

#### Scenario: Keyboard navigation
- **WHEN** the modal opens
- **THEN** focus SHALL be trapped within the modal
- **AND** the "Continue" and "Log Out" buttons SHALL be reachable via Tab key
- **AND** Enter/Space SHALL activate the focused button

#### Scenario: Screen reader announcement
- **WHEN** the modal opens
- **THEN** it SHALL have `aria-modal="true"` and `role="dialog"`
- **AND** the modal content SHALL be announced to screen readers

#### Scenario: Event listeners cleaned up on unmount
- **WHEN** the AuthProvider unmounts
- **THEN** all inactivity event listeners SHALL be removed
- **AND** the inactivity check interval SHALL be cleared

