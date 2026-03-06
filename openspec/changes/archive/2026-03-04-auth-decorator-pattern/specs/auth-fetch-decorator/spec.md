## ADDED Requirements

### Requirement: withAuth decorator injects auth headers and retries on 401
The `withAuth` higher-order function SHALL accept a `fetch`-compatible function and return a new `fetch`-compatible function that transparently injects an `Authorization` header from the current auth token and handles 401 responses via token refresh and request replay.

#### Scenario: Auth header injected on every request
- **WHEN** a request is made through a `withAuth`-wrapped fetch
- **THEN** the decorator SHALL call `getAuthHeaders()` and merge the result into `init.headers`
- **AND** existing headers in `init` SHALL be preserved (auth headers merged, not replaced)

#### Scenario: Successful request passes through unchanged
- **WHEN** a request through `withAuth` returns a non-401 response
- **THEN** the decorator SHALL return the response as-is without modification

#### Scenario: 401 triggers refresh and replay
- **WHEN** a request through `withAuth` returns a 401 response
- **THEN** the decorator SHALL call `ensureFreshToken()` to obtain a new access token
- **AND** replay the original request with the new token in the `Authorization` header
- **AND** return the replayed response to the caller

#### Scenario: Second 401 after replay triggers hard logout
- **WHEN** a replayed request also returns 401
- **THEN** the decorator SHALL call `hardLogout()` to clear all auth state and redirect to `/login`
- **AND** throw `Error("Session expired")`

#### Scenario: No refresh token triggers hard logout
- **WHEN** a 401 response is received and `ensureFreshToken()` returns null (no refresh token)
- **THEN** the decorator SHALL call `hardLogout()` and throw `Error("Session expired")`

### Requirement: withPreAuth decorator proactively refreshes before request
The `withPreAuth` higher-order function SHALL accept a `fetch`-compatible function and return a new `fetch`-compatible function that proactively refreshes the auth token if it is near expiry before making the request. This is designed for SSE streams and other requests that cannot be transparently replayed.

#### Scenario: Token still fresh — no pre-refresh
- **WHEN** the stored `auth_token_expires_at` indicates more than 60 seconds until expiry
- **THEN** the decorator SHALL use the existing token without calling the refresh endpoint

#### Scenario: Token near expiry — proactive refresh
- **WHEN** the stored `auth_token_expires_at` indicates 60 seconds or less until expiry
- **THEN** the decorator SHALL call `ensureFreshToken()` before making the request
- **AND** use the refreshed token in the request headers

#### Scenario: No expiry timestamp — use existing token
- **WHEN** no `auth_token_expires_at` value exists in localStorage
- **THEN** the decorator SHALL use the existing token from `getAuthHeaders()` without attempting refresh

#### Scenario: Pre-refresh failure — proceed with existing token
- **WHEN** proactive refresh fails (network error or refresh token invalid)
- **THEN** the decorator SHALL proceed with the existing token
- **AND** rely on the post-response 401 handler as fallback

#### Scenario: 401 fallback retry after pre-auth
- **WHEN** a request through `withPreAuth` returns a 401 response despite pre-refresh
- **THEN** the decorator SHALL attempt the same refresh-and-replay logic as `withAuth`

### Requirement: Auth utilities located in lib/auth package
All auth-related utilities (token storage keys, header generation, logout, token refresh, decorators) SHALL be exported from `lib/auth/`. The `lib/api/` package SHALL NOT contain auth logic.

#### Scenario: Token storage in auth package
- **WHEN** code needs to access auth token keys (`TOKEN_KEY`, `REFRESH_TOKEN_KEY`, `EXPIRES_AT_KEY`, `ACTIVITY_KEY`) or utility functions (`getAuthHeaders`, `hardLogout`)
- **THEN** these SHALL be importable from `lib/auth/tokenStorage`

#### Scenario: Token refresh in auth package
- **WHEN** code needs token refresh logic (`ensureFreshToken`, `_resetRefreshState`)
- **THEN** these SHALL be importable from `lib/auth/tokenRefresh`

#### Scenario: Decorators in auth package
- **WHEN** code needs auth-aware fetch (`withAuth`, `withPreAuth`)
- **THEN** these SHALL be importable from `lib/auth/withAuth`

#### Scenario: Barrel export from auth index
- **WHEN** code imports from `lib/auth`
- **THEN** all public auth symbols SHALL be available via the barrel export in `lib/auth/index.ts`

### Requirement: Backend API client uses withAuth decorator
The backend API client (`lib/api/client.ts`) SHALL use `withAuth(fetch)` for all requests instead of manually calling `getAuthHeaders()` and `withAuthRetry()`.

#### Scenario: GET request uses decorator
- **WHEN** `client.get()` is called
- **THEN** it SHALL use `withAuth(fetch)` which handles auth header injection and 401 retry
- **AND** the function SHALL NOT directly call `getAuthHeaders()` or `withAuthRetry()`

#### Scenario: Session expired converted to ApiError
- **WHEN** the `withAuth` decorator throws `Error("Session expired")`
- **THEN** `client.ts` SHALL catch it and throw `ApiError(401, "Session expired")`

#### Scenario: File upload uses decorator
- **WHEN** `client.uploadFile()` is called
- **THEN** the `FormData` body SHALL be sent through `withAuth(fetch)` without a `Content-Type` header (letting the browser set multipart boundary)
- **AND** auth headers SHALL be injected by the decorator
