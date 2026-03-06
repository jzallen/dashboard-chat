## MODIFIED Requirements

### Requirement: Frontend stores refresh token and expiry timestamp
The frontend SHALL store four localStorage keys for auth state: `auth_token`, `auth_user`, `auth_refresh_token`, and `auth_token_expires_at` (Unix timestamp in milliseconds). All reads and writes to these keys SHALL go through the getter/setter API in `lib/auth/tokenStorage` rather than direct `localStorage.getItem()`/`localStorage.setItem()` calls with raw key constants.

#### Scenario: Tokens stored on callback
- **WHEN** the frontend receives a successful callback response
- **THEN** it SHALL store auth data by calling `setToken()`, `setUser()`, `setRefreshToken()`, and `setTokenExpiry()` from `lib/auth/tokenStorage`
- **AND** `tokenExpiresAt` SHALL be computed as `Date.now() + (expires_in * 1000)`

#### Scenario: Tokens updated on refresh
- **WHEN** a background refresh succeeds
- **THEN** it SHALL update auth data by calling `setToken()`, `setRefreshToken()`, and `setTokenExpiry()` from `lib/auth/tokenStorage`
- **AND** the previous refresh token SHALL be overwritten (WorkOS tokens are single-use with rotation)

#### Scenario: All tokens cleared on logout
- **WHEN** the user logs out
- **THEN** `clearAll()` from `lib/auth/tokenStorage` SHALL be called to remove all auth keys

### Requirement: 401 interceptor with coalesced refresh and request replay
The frontend API layer SHALL intercept 401 responses, attempt a silent token refresh, and replay the failed request. Concurrent 401s SHALL be coalesced into a single refresh call. The `ensureFreshToken()` function SHALL use getter/setter functions from `lib/auth/tokenStorage` instead of direct localStorage access with raw key constants.

#### Scenario: Single 401 triggers refresh and replay
- **WHEN** an API call returns 401 and a refresh token is available
- **THEN** the interceptor SHALL call `ensureFreshToken()` which reads the refresh token via `getRefreshToken()`
- **AND** on success, replay the original request with the new access token
- **AND** return the replayed response to the caller transparently

#### Scenario: Concurrent 401s coalesced into single refresh
- **WHEN** multiple API calls return 401 simultaneously
- **THEN** only one refresh call SHALL be made
- **AND** all failed requests SHALL be queued and replayed after the refresh completes
- **AND** all replayed requests SHALL use the same new access token

#### Scenario: Freshness guard uses getter
- **WHEN** `ensureFreshToken()` checks whether the current token is still valid
- **THEN** it SHALL call `getTokenExpiry()` to read the expiry timestamp
- **AND** if the token is valid for more than 60 seconds, return the current token via `getToken()`

#### Scenario: Refresh success updates storage via setters
- **WHEN** `ensureFreshToken()` receives a successful refresh response
- **THEN** it SHALL call `setToken()`, `setRefreshToken()`, and `setTokenExpiry()` to persist the new tokens

#### Scenario: Refresh failure triggers hard logout
- **WHEN** a 401 triggers a refresh and the refresh call fails (after 1 retry)
- **THEN** the system SHALL clear all auth tokens from localStorage
- **AND** redirect to `/login`

#### Scenario: No infinite retry loop
- **WHEN** a 401 triggers a refresh, and the replayed request also returns 401
- **THEN** the interceptor SHALL NOT attempt another refresh
- **AND** the system SHALL proceed to hard logout
