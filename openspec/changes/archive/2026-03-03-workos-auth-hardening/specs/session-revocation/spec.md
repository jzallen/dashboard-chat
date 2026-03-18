## ADDED Requirements

### Requirement: Backend revokes WorkOS session on logout
The backend `POST /api/auth/logout` endpoint SHALL extract the access token from the Authorization header and POST to the WorkOS session revocation API. Revocation SHALL be best-effort — failures are logged but do not block the logout response.

#### Scenario: Successful session revocation
- **WHEN** an authenticated user calls `POST /api/auth/logout`
- **THEN** the backend SHALL POST to `https://api.workos.com/user_management/sessions/revoke` with the access token
- **AND** use a 5-second timeout
- **AND** return the logout response regardless of revocation outcome

#### Scenario: Revocation API failure is non-fatal
- **WHEN** the WorkOS revocation API returns an error or times out
- **THEN** the backend SHALL log a warning
- **AND** still return the logout response successfully
- **AND** SHALL NOT raise an exception to the caller

#### Scenario: No token provided to logout
- **WHEN** `POST /api/auth/logout` is called without an Authorization header
- **THEN** the backend SHALL skip revocation
- **AND** return the logout response normally

### Requirement: Frontend calls backend logout before clearing state
The frontend `logout()` function SHALL fire a `POST /api/auth/logout` request with the current Bearer token before clearing localStorage and resetting auth state. The request SHALL be fire-and-forget — failures do not block local logout.

#### Scenario: Logout with valid token
- **WHEN** the user triggers logout and a token exists in localStorage
- **THEN** the frontend SHALL send `POST /api/auth/logout` with `Authorization: Bearer <token>`
- **AND** clear all auth localStorage keys
- **AND** reset auth state to unauthenticated

#### Scenario: Logout network failure
- **WHEN** the `POST /api/auth/logout` request fails (network error, timeout, etc.)
- **THEN** the frontend SHALL still clear all auth localStorage keys
- **AND** reset auth state to unauthenticated

#### Scenario: Logout without token
- **WHEN** the user triggers logout and no token exists in localStorage
- **THEN** the frontend SHALL skip the backend call
- **AND** clear all auth localStorage keys
- **AND** reset auth state to unauthenticated

### Requirement: Dev provider skips session revocation
The dev provider SHALL NOT call any external API on logout.

#### Scenario: Dev mode logout
- **WHEN** logout is called in dev mode
- **THEN** `get_logout_url()` SHALL return `"/"`
- **AND** no HTTP request SHALL be made to WorkOS
