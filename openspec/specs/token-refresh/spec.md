# token-refresh Specification

## Purpose
TBD - created by archiving change token-refresh-flow. Update Purpose after archive.
## Requirements
### Requirement: AuthProvider protocol includes refresh capability
The `AuthProvider` protocol SHALL define a `refresh_access_token(refresh_token: str)` method that returns `tuple[AuthUser, str, str, int]` (user, access_token, refresh_token, expires_in). The `handle_callback` method SHALL return `tuple[AuthUser, str, str, int]` instead of `tuple[AuthUser, str]`.

#### Scenario: WorkOS provider implements refresh_access_token
- **WHEN** the backend receives a valid refresh token via `refresh_access_token`
- **THEN** it SHALL call WorkOS authenticate with `grant_type: "urn:workos:oauth:grant-type:refresh-token"`, `client_id`, `client_secret`, and `refresh_token`
- **AND** return the new `(user, access_token, refresh_token, expires_in)` tuple
- **AND** `expires_in` SHALL be computed as `jwt.exp - int(time.time())` from the new access token

#### Scenario: WorkOS provider handle_callback returns refresh token
- **WHEN** the backend exchanges an authorization code via `handle_callback`
- **THEN** it SHALL extract `refresh_token` from the WorkOS response
- **AND** return `(user, access_token, refresh_token, expires_in)` with `expires_in` derived from the JWT `exp` claim

#### Scenario: Dev provider implements refresh_access_token
- **WHEN** `refresh_access_token` is called with a token matching prefix `dev-refresh-token-`
- **THEN** it SHALL return `(DEV_USER, DEV_TOKEN, "dev-refresh-token-<N+1>", 300)` where N is incremented from the input token suffix
- **AND** the simulated TTL SHALL be 300 seconds

#### Scenario: Dev provider handle_callback returns simulated refresh data
- **WHEN** `handle_callback` is called in dev mode
- **THEN** it SHALL return `(DEV_USER, DEV_TOKEN, "dev-refresh-token-001", 300)`

#### Scenario: Dev provider rejects invalid refresh token prefix
- **WHEN** `refresh_access_token` is called with a token that does not match `dev-refresh-token-*`
- **THEN** it SHALL raise `AuthenticationError`

### Requirement: Backend exposes POST /api/auth/refresh endpoint
The backend SHALL expose a `POST /api/auth/refresh` endpoint that accepts `{ "refresh_token": string }` and returns `{ "access_token": string, "refresh_token": string, "expires_in": number }`. This endpoint SHALL be in `PUBLIC_PATHS` (no Bearer token required).

#### Scenario: Successful token refresh
- **WHEN** a valid refresh token is posted to `POST /api/auth/refresh`
- **THEN** the backend SHALL call `provider.refresh_access_token(refresh_token)`
- **AND** return `200` with `{ "access_token": "<new>", "refresh_token": "<new>", "expires_in": <seconds> }`

#### Scenario: Invalid or expired refresh token
- **WHEN** an invalid or expired refresh token is posted to `POST /api/auth/refresh`
- **THEN** the backend SHALL return `401` with `{ "detail": "Refresh token invalid or expired" }`

#### Scenario: Rate limiting on refresh endpoint
- **WHEN** more than 1 refresh request from the same IP arrives within 10 seconds
- **THEN** the backend SHALL return `429` with `{ "detail": "Too many refresh requests" }`

#### Scenario: Refresh endpoint is publicly accessible
- **WHEN** a request is made to `POST /api/auth/refresh` without an Authorization header
- **THEN** the middleware SHALL NOT reject it (the path is in PUBLIC_PATHS)

### Requirement: Callback response includes refresh token and expiry
The `POST /api/auth/callback` endpoint SHALL return `{ "user": {...}, "token": "<access_token>", "refresh_token": "<refresh_token>", "expires_in": <seconds> }`.

#### Scenario: Callback response shape
- **WHEN** the frontend posts an authorization code to `POST /api/auth/callback`
- **THEN** the response SHALL include `refresh_token` (string) and `expires_in` (integer, seconds until access token expiry)
- **AND** the existing `user` and `token` fields SHALL remain unchanged

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

### Requirement: Proactive background token refresh timer
The frontend AuthProvider SHALL run a timer that fires at 80% of the access token TTL and calls `POST /api/auth/refresh` to obtain new tokens before the current token expires.

#### Scenario: Timer fires at 80% TTL
- **WHEN** a token is issued with `expires_in` of 300 seconds
- **THEN** the refresh timer SHALL fire at 240 seconds (300 * 0.8)
- **AND** the timer SHALL call `POST /api/auth/refresh` with the stored refresh token

#### Scenario: Successful proactive refresh
- **WHEN** the proactive refresh timer fires and the refresh call succeeds
- **THEN** the new tokens SHALL be stored in localStorage and AuthState
- **AND** the timer SHALL be reset with the new `expires_in` value
- **AND** the user SHALL see no UI change (no spinner, modal, navigation, or layout shift)

#### Scenario: Proactive refresh failure with retry
- **WHEN** the proactive refresh timer fires and the refresh call fails
- **THEN** the system SHALL wait 5 seconds and retry once
- **AND** if the retry succeeds, tokens SHALL be updated and the timer reset
- **AND** if the retry also fails, the system SHALL call `logout()`

#### Scenario: Timer cleanup on unmount
- **WHEN** the AuthProvider unmounts or the user logs out
- **THEN** the refresh timer SHALL be cleared

#### Scenario: Refresh cycle repeats indefinitely
- **WHEN** a successful refresh occurs
- **THEN** a new timer SHALL be set for 80% of the new token's TTL
- **AND** the cycle SHALL continue as long as the session is valid

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

#### Scenario: No refresh token available on 401
- **WHEN** an API call returns 401 and no refresh token exists in localStorage
- **THEN** the system SHALL immediately clear tokens and redirect to `/login`

### Requirement: Both client.ts and fetchUtils.ts use shared interceptor
All frontend API clients SHALL use the `withAuth` decorator (from `lib/auth/withAuth.ts`) which encapsulates the shared coalesced refresh interceptor. The decorator internally delegates to `ensureFreshToken()` in `lib/auth/tokenRefresh.ts`, ensuring all API clients participate in the same refresh promise coalescence. Direct calls to `withAuthRetry()` or `getAuthHeaders()` from API client code SHALL NOT occur — these are internal implementation details of the decorator.

#### Scenario: Consistent 401 handling across API modules
- **WHEN** a 401 is received by either the backend API client (`client.ts`) or the chat worker client (`chatClient.ts`)
- **THEN** both SHALL handle it through their respective `withAuth(fetch)` decorator instance
- **AND** both decorator instances SHALL delegate to the same `ensureFreshToken()` function
- **AND** both SHALL participate in the same refresh promise coalescence (single in-flight refresh request)

#### Scenario: Backend API client no longer calls withAuthRetry directly
- **WHEN** `client.ts` makes an HTTP request
- **THEN** it SHALL use `withAuth(fetch)` which internally handles 401 retry
- **AND** it SHALL NOT import or call `withAuthRetry()` directly

#### Scenario: Chat worker client no longer calls getAuthHeaders directly
- **WHEN** `chatClient.ts` makes an HTTP request
- **THEN** it SHALL use `withAuth(fetch)` or `withPreAuth(fetch)` which internally injects auth headers
- **AND** it SHALL NOT import or call `getAuthHeaders()` directly

