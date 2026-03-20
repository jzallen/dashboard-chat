## ADDED Requirements

### Requirement: Auth proxy validates Bearer tokens and forwards identity headers
The auth proxy service SHALL accept incoming HTTP requests, validate the Bearer token in the `Authorization` header, and forward the request to the backend with identity headers (`X-User-Id`, `X-Org-Id`, `X-User-Email`) set from the validated token claims. Invalid or missing tokens SHALL be rejected with a 401 response before the request reaches the backend.

#### Scenario: Valid WorkOS JWT is accepted and identity forwarded
- **WHEN** a request arrives with a valid WorkOS JWT Bearer token
- **THEN** the proxy SHALL verify the JWT signature against WorkOS JWKS
- **AND** extract `sub` (user ID), `org_id`, and `email` from the token claims
- **AND** forward the request to the backend with `X-User-Id`, `X-Org-Id`, and `X-User-Email` headers set
- **AND** strip any client-supplied `X-User-Id`, `X-Org-Id`, or `X-User-Email` headers before forwarding

#### Scenario: Missing Authorization header returns 401
- **WHEN** a request arrives without an `Authorization` header
- **AND** the request path is not in the public paths list
- **THEN** the proxy SHALL return a 401 response with `{"error": "Missing or invalid Authorization header"}`

#### Scenario: Invalid or expired JWT returns 401
- **WHEN** a request arrives with a Bearer token that fails JWT verification (invalid signature, expired, wrong audience)
- **THEN** the proxy SHALL return a 401 response with `{"error": "Invalid or expired token"}`
- **AND** SHALL NOT forward the request to the backend

#### Scenario: Public paths are forwarded without authentication
- **WHEN** a request arrives for `/health`, `/api/auth/login`, `/api/auth/callback`, `/api/auth/logout`, or `/api/auth/refresh`
- **THEN** the proxy SHALL forward the request to the backend without token validation
- **AND** SHALL NOT set identity headers

### Requirement: Auth proxy supports dev mode
The auth proxy SHALL support a dev mode (`AUTH_MODE=dev`) that accepts the static dev token without WorkOS JWT verification and forwards hardcoded dev user identity headers.

#### Scenario: Dev token accepted in dev mode
- **WHEN** `AUTH_MODE` is `"dev"` and a request arrives with `Authorization: Bearer dev-token-static`
- **THEN** the proxy SHALL forward the request with `X-User-Id: dev-user-001`, `X-Org-Id: dev-org-001`, `X-User-Email: dev@localhost`

#### Scenario: Invalid dev token rejected in dev mode
- **WHEN** `AUTH_MODE` is `"dev"` and a request arrives with a Bearer token other than `dev-token-static`
- **THEN** the proxy SHALL return a 401 response

### Requirement: Auth proxy runs as a Hono service
The auth proxy SHALL be implemented as a Hono HTTP service that proxies requests to a configurable backend target URL.

#### Scenario: Health endpoint
- **WHEN** a GET request is made to `/health`
- **THEN** the proxy SHALL return `{"status": "ok"}` with status 200

#### Scenario: Backend target configuration
- **WHEN** the proxy starts
- **THEN** it SHALL read the backend target URL from `BACKEND_URL` environment variable (default: `http://api:8000`)

#### Scenario: Request and response proxying
- **WHEN** a request passes authentication
- **THEN** the proxy SHALL forward the full request (method, path, query params, body, headers) to the backend
- **AND** return the backend's response (status, headers, body) to the client unchanged
