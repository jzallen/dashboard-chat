## ADDED Requirements

### Requirement: Authorize URL includes scope, nonce, and state parameters
The `get_login_url()` method SHALL include `scope=openid profile email`, a cryptographically random `nonce`, and a cryptographically random `state` parameter in the authorize URL query string.

#### Scenario: Authorize URL contains all required parameters
- **WHEN** the backend constructs the authorize URL via `get_login_url()`
- **THEN** the URL SHALL contain `scope=openid+profile+email`
- **AND** the URL SHALL contain a `nonce` parameter with at least 32 bytes of entropy (URL-safe base64)
- **AND** the URL SHALL contain a `state` parameter with at least 32 bytes of entropy (URL-safe base64)
- **AND** the URL SHALL contain `client_id`, `redirect_uri`, `response_type=code`, and `provider=authkit`

#### Scenario: State is returned to the frontend for CSRF verification
- **WHEN** the frontend calls `GET /api/auth/login`
- **THEN** the response SHALL include both `url` and `state` fields: `{ "url": "...", "state": "..." }`
- **AND** the `state` value SHALL match the `state` parameter embedded in the URL

### Requirement: Frontend stores and verifies OAuth state parameter
The frontend SHALL store the `state` value from the login response in `sessionStorage` and verify it matches the `state` query parameter on the callback URL before exchanging the authorization code.

#### Scenario: State stored on login redirect
- **WHEN** the frontend calls `GET /api/auth/login` and receives `{ url, state }`
- **THEN** it SHALL store `state` in `sessionStorage` under key `oauth_state`
- **AND** redirect to the `url`

#### Scenario: State verified on callback
- **WHEN** the `AuthCallback` component loads with `?code=...&state=...` query parameters
- **THEN** it SHALL read `oauth_state` from `sessionStorage`
- **AND** compare it to the `state` query parameter
- **AND** proceed with code exchange only if they match
- **AND** remove `oauth_state` from `sessionStorage` after comparison

#### Scenario: State mismatch rejects callback
- **WHEN** the `state` query parameter does not match the stored `oauth_state`
- **THEN** the frontend SHALL NOT exchange the authorization code
- **AND** SHALL redirect to `/login`

#### Scenario: Missing state rejects callback
- **WHEN** the callback URL has no `state` query parameter or `sessionStorage` has no `oauth_state`
- **THEN** the frontend SHALL NOT exchange the authorization code
- **AND** SHALL redirect to `/login`

### Requirement: Code exchange includes redirect_uri
The `handle_callback()` method SHALL include `redirect_uri` in the token exchange POST body, matching the `redirect_uri` sent in the authorize request.

#### Scenario: redirect_uri present in code exchange
- **WHEN** the backend exchanges an authorization code with WorkOS
- **THEN** the POST body SHALL include `redirect_uri` matching `settings.workos_redirect_uri`
- **AND** WorkOS SHALL accept the exchange (WorkOS requires redirect_uri when it was in the authorize request)
