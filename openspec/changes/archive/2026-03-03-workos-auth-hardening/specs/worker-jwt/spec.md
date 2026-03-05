## ADDED Requirements

### Requirement: Worker verifies JWT locally using JWKS
In production mode (`AUTH_MODE !== "dev"`), the worker SHALL verify access tokens locally using `jose.jwtVerify()` with a cached JWKS keyset from WorkOS. The worker SHALL NOT call the backend's `/api/auth/me` endpoint.

#### Scenario: Valid JWT accepted by worker
- **WHEN** a request arrives with a valid WorkOS JWT in the Authorization header
- **THEN** the worker SHALL verify the signature against WorkOS JWKS
- **AND** verify `aud` matches `WORKOS_CLIENT_ID`
- **AND** verify `iss` matches `"https://api.workos.com"`
- **AND** verify the algorithm is `RS256`
- **AND** allow the request to proceed

#### Scenario: Expired JWT rejected by worker
- **WHEN** a request arrives with an expired JWT
- **THEN** `jwtVerify` SHALL throw
- **AND** the worker SHALL return 401 with `{ "error": "Invalid or expired token" }`

#### Scenario: JWT with wrong audience rejected
- **WHEN** a request arrives with a JWT whose `aud` does not match `WORKOS_CLIENT_ID`
- **THEN** the worker SHALL return 401

#### Scenario: JWT with wrong issuer rejected
- **WHEN** a request arrives with a JWT whose `iss` does not match `"https://api.workos.com"`
- **THEN** the worker SHALL return 401

### Requirement: Worker JWKS is lazily initialized and cached
The JWKS keyset SHALL be created on first use (not at module load) and cached for subsequent requests. The `jose` library SHALL handle key rotation automatically.

#### Scenario: First request initializes JWKS
- **WHEN** the first production-mode request arrives
- **THEN** the worker SHALL create a `RemoteJWKSet` pointing to `https://api.workos.com/sso/jwks/{WORKOS_CLIENT_ID}`
- **AND** cache it for all subsequent requests

#### Scenario: Subsequent requests reuse cached JWKS
- **WHEN** a second production-mode request arrives
- **THEN** the worker SHALL reuse the cached JWKS keyset
- **AND** SHALL NOT create a new one

### Requirement: Worker requires WORKOS_CLIENT_ID in production mode
If `AUTH_MODE` is not `"dev"` and `WORKOS_CLIENT_ID` is empty or unset, the worker SHALL reject all authenticated requests.

#### Scenario: Missing WORKOS_CLIENT_ID in production
- **WHEN** `AUTH_MODE` is `"workos"` and `WORKOS_CLIENT_ID` is empty
- **THEN** the worker SHALL return 401 with a configuration error message
- **AND** SHALL NOT silently allow requests through

### Requirement: Worker dev mode unchanged
In dev mode (`AUTH_MODE === "dev"`), the worker SHALL continue to validate tokens by comparing against the hardcoded `DEV_TOKEN` string. No JWKS or JWT verification is used.

#### Scenario: Dev mode token validation
- **WHEN** `AUTH_MODE` is `"dev"` and a request arrives with `Authorization: Bearer dev-token-static`
- **THEN** the worker SHALL accept the request

#### Scenario: Dev mode invalid token
- **WHEN** `AUTH_MODE` is `"dev"` and a request arrives with any other Bearer token
- **THEN** the worker SHALL return 401
