## ADDED Requirements

### Requirement: 401 recovery e2e test
The e2e suite SHALL include a test that verifies the application recovers from an expired access token.

#### Scenario: API call retries after 401
- **WHEN** the access token is expired (cleared from localStorage)
- **AND** the user triggers an API call
- **THEN** the application SHALL attempt a token refresh
- **AND** the API call SHALL be retried with the new token
- **AND** the user SHALL see the expected data without an error message

#### Scenario: Failed refresh redirects to login
- **WHEN** both the access token and refresh token are invalid
- **AND** the user triggers an API call
- **THEN** the application SHALL redirect to the login page
- **AND** `localStorage` SHALL be cleared of `auth_token` and `auth_user`

### Requirement: Activity check modal e2e test
The e2e suite SHALL include a test that verifies the inactivity modal appears and functions correctly.

#### Scenario: Activity check modal appears after inactivity
- **WHEN** the inactivity timer fires (simulated by advancing timers or using a short test timeout)
- **THEN** a modal SHALL appear with text "Are you still there?"
- **AND** the modal SHALL display a countdown timer

#### Scenario: Confirming activity dismisses modal
- **WHEN** the activity check modal is visible
- **AND** the user clicks "Yes, I'm here" or presses any key
- **THEN** the modal SHALL close
- **AND** the session SHALL continue without interruption

#### Scenario: Timeout logs user out
- **WHEN** the activity check modal is visible
- **AND** the countdown reaches zero without interaction
- **THEN** the user SHALL be logged out
- **AND** the page SHALL redirect to the login page

### Requirement: Auth tests use dev mode simulation
Auth lifecycle e2e tests SHALL run in dev mode (`AUTH_MODE=dev`) and use Playwright's clock/timer APIs to simulate time-based triggers rather than waiting for real timeouts.

#### Scenario: Inactivity timer is simulated
- **WHEN** the activity check test needs to trigger the inactivity timer
- **THEN** it SHALL use `page.clock.fastForward()` or equivalent to advance time
- **AND** SHALL NOT use `page.waitForTimeout()` with real delays exceeding 5 seconds
