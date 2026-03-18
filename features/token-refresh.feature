Feature: Token Refresh and Session Lifecycle
  As an authenticated user working in the application
  I expect my session to stay alive seamlessly while I am active
  So that I am never interrupted by token expiry during normal use

  Background:
    Given the user is authenticated in WorkOS mode
    And the access token has a 15-minute lifetime
    And the refresh token is stored in the auth context

  # --- Silent Background Refresh ---
  Scenario: Token refreshes automatically before expiry
    Given the user has been active for 13 minutes since the last token issue
    When the background refresh timer fires at the 80% lifetime mark
    Then the system calls POST /api/auth/refresh with the current refresh token
    And a new access token is stored in localStorage
    And a new refresh token replaces the previous one in the auth context
    And the user sees no interruption, modal, or loading indicator

  # --- 401 Recovery ---
  Scenario: API call receives 401 and retries after refresh
    Given the access token has just expired
    When the user triggers an API call that returns 401 Unauthorized
    Then the system automatically calls POST /api/auth/refresh
    And the failed API call is retried with the new access token
    And the retried call succeeds
    And the user sees the expected data without any error message

  Scenario: Retried call fails after refresh
    Given the access token has expired
    And the refresh token is also invalid
    When the user triggers an API call that returns 401 Unauthorized
    Then the system attempts to refresh the token
    And the refresh call fails with 401
    Then the user is redirected to the login page
    And localStorage is cleared of auth_token and auth_user

  # --- Activity Check After 1 Hour ---
  Scenario: Activity check modal appears after 1 hour of no interaction
    Given the user has not interacted with the application for 60 minutes
    When the inactivity timer fires
    Then a modal dialog appears asking "Are you still there?"
    And the modal displays a 2-minute countdown timer
    And background refresh continues while the modal is open

  # --- Activity Confirmed ---
  Scenario: User confirms activity and session continues
    Given the "Are you still there?" modal is displayed
    When the user clicks "Yes, I'm here"
    Then the modal closes
    And the inactivity timer resets to 60 minutes
    And the session continues without interruption
    And the access token is refreshed immediately

  Scenario: Any user interaction dismisses the activity check
    Given the "Are you still there?" modal is displayed
    When the user presses any key or moves the mouse
    Then the modal closes
    And the inactivity timer resets to 60 minutes

  # --- Activity Timeout ---
  Scenario: No response to activity check logs the user out
    Given the "Are you still there?" modal is displayed
    And the 2-minute countdown is running
    When the countdown reaches zero without user interaction
    Then the modal closes
    And the user is logged out
    And localStorage is cleared of auth_token and auth_user
    And the user is redirected to the login page
    And a toast notification displays "Session ended due to inactivity"

  # --- Refresh Token Rotation ---
  Scenario: Old refresh token is invalidated after rotation
    Given the system has just completed a token refresh
    And a new refresh token "RT-new" has replaced the old token "RT-old"
    When a request is made using "RT-old"
    Then the server rejects it with 401
    And only "RT-new" is accepted for subsequent refresh calls

  Scenario: New refresh token is persisted after rotation
    When the system completes a token refresh
    Then the new access token is written to localStorage under "auth_token"
    And the new refresh token is stored in the auth context
    And the previous refresh token is no longer referenced anywhere in memory

  # --- Refresh Failure ---
  Scenario: Refresh fails when WorkOS session is expired
    Given the user's WorkOS session has been revoked or expired
    When the background refresh timer fires
    And the system calls POST /api/auth/refresh
    Then the server responds with 401 and body containing "Session expired"
    And the user is redirected to the login page
    And localStorage is cleared of auth_token and auth_user

  Scenario: Refresh fails due to network error
    Given the network connection is unavailable
    When the background refresh timer fires
    Then the refresh call fails with a network error
    And the system retries the refresh up to 3 times with exponential backoff
    And if all retries fail, the user sees a banner "Connection lost. Retrying..."
    And the user is not logged out while retries are in progress

  # --- Chat Stream Pre-check ---
  Scenario: Token is refreshed before starting a chat stream when near expiry
    Given the access token will expire in less than 2 minutes
    When the user sends a chat message
    Then the system refreshes the token before opening the SSE connection
    And the SSE stream is opened with the new access token in the Authorization header
    And the chat response streams without authentication errors

  Scenario: Chat stream proceeds without pre-check when token is fresh
    Given the access token will not expire for another 10 minutes
    When the user sends a chat message
    Then the SSE stream is opened immediately with the current access token
    And no refresh call is made before the stream starts

  # --- Concurrent 401 Coalescing ---
  Scenario: Multiple simultaneous 401 responses trigger only one refresh
    Given three API calls are in flight simultaneously
    And all three receive 401 Unauthorized responses
    When the first 401 triggers a token refresh
    Then the second and third 401 handlers wait for the in-progress refresh
    And only one POST /api/auth/refresh call is made to the server
    And all three original API calls are retried with the same new access token
    And the user sees no errors from any of the three calls

  Scenario: Queued requests use the refreshed token once available
    Given a token refresh is already in progress
    When a new API call is initiated
    Then the new call waits for the in-progress refresh to complete
    And the new call uses the refreshed token
    And no additional refresh call is made

  # --- Dev Mode Refresh Simulation ---
  Scenario: Dev mode simulates background refresh timing
    Given the user is authenticated in dev mode with AUTH_MODE="dev"
    And the dev token "dev-token-static" is in use
    When the background refresh timer fires at the 80% lifetime mark
    Then the system simulates a token refresh without making a network call
    And the same dev token remains in localStorage
    And the refresh cycle resets as if a real refresh occurred
    And no errors are thrown

  Scenario: Dev mode activity check behaves identically to production
    Given the user is authenticated in dev mode
    And the user has not interacted with the application for 60 minutes
    When the inactivity timer fires
    Then the "Are you still there?" modal appears
    And the countdown and dismissal behavior matches WorkOS mode exactly

  Scenario: Dev mode 401 handling skips refresh and re-authenticates
    Given the user is authenticated in dev mode
    When an API call returns 401 Unauthorized
    Then the system restores the dev token without a refresh call
    And the failed API call is retried with the dev token
    And no redirect to the login page occurs
