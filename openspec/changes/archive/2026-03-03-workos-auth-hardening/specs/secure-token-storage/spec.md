## ADDED Requirements

### Requirement: Refresh token stored in httpOnly secure cookie
The backend SHALL set the refresh token as an `httpOnly; Secure; SameSite=Lax` cookie on the callback and refresh responses. The frontend SHALL NOT store or access the refresh token directly.

#### Scenario: Callback sets refresh cookie
- **WHEN** the backend returns a successful callback response
- **THEN** it SHALL set a `Set-Cookie` header: `wos_refresh=<token>; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/refresh`
- **AND** the JSON response body SHALL NOT include `refresh_token`

#### Scenario: Refresh endpoint reads cookie
- **WHEN** the frontend calls `POST /api/auth/refresh`
- **THEN** the browser SHALL automatically attach the `wos_refresh` cookie
- **AND** the backend SHALL read the refresh token from the cookie (not the request body)
- **AND** set an updated `wos_refresh` cookie in the response

#### Scenario: Logout clears refresh cookie
- **WHEN** the user logs out
- **THEN** the backend SHALL set `Set-Cookie: wos_refresh=; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/refresh; Max-Age=0`
- **AND** the frontend SHALL clear only the access token and user from localStorage

#### Scenario: XSS cannot exfiltrate refresh token
- **WHEN** malicious JavaScript executes in the browser
- **THEN** it SHALL NOT be able to read the `wos_refresh` cookie (httpOnly prevents `document.cookie` access)
- **AND** it SHALL NOT be able to send the cookie to a third-party origin (SameSite=Lax prevents cross-origin requests)

### Requirement: CORS configured for cookie credentials
When secure token storage is enabled, CORS SHALL be configured with `credentials: include` and an explicit origin (not wildcard `*`).

#### Scenario: CORS allows credentialed requests
- **WHEN** the frontend makes a request to `POST /api/auth/refresh`
- **THEN** the request SHALL include `credentials: "include"`
- **AND** the backend SHALL respond with `Access-Control-Allow-Credentials: true`
- **AND** `Access-Control-Allow-Origin` SHALL be the exact frontend origin (not `*`)

### Requirement: Access token remains in JavaScript memory
The access token SHALL continue to be stored in localStorage (or JavaScript memory) for inclusion in Authorization headers. Only the refresh token migrates to httpOnly cookie.

#### Scenario: API calls still use Bearer header
- **WHEN** the frontend makes an authenticated API call
- **THEN** it SHALL include `Authorization: Bearer <access_token>` from localStorage
- **AND** SHALL NOT rely on cookies for API authentication

**NOTE**: This capability is P3 (design only). Implementation is deferred to a future change.
