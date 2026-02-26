## ADDED Requirements

### Requirement: Backend JWT verification enforces audience and issuer
The backend `workos_provider.py` `verify_token()` method SHALL pass `audience` and `issuer` parameters to `jwt.decode()` so that PyJWT validates these claims automatically. Manual audience checking logic after decode SHALL NOT exist.

#### Scenario: Token with correct audience and issuer is accepted
- **WHEN** a request arrives with a JWT containing `aud: <WORKOS_CLIENT_ID>` and `iss: "https://api.workos.com"`
- **THEN** the backend SHALL decode the token successfully
- **AND** return the `AuthUser` derived from the JWT claims

#### Scenario: Token with wrong audience is rejected
- **WHEN** a request arrives with a JWT containing `aud: "some-other-client-id"`
- **THEN** `jwt.decode()` SHALL raise `InvalidAudienceError`
- **AND** the middleware SHALL return 401

#### Scenario: Token with wrong issuer is rejected
- **WHEN** a request arrives with a JWT containing `iss: "https://evil.example.com"`
- **THEN** `jwt.decode()` SHALL raise `InvalidIssuerError`
- **AND** the middleware SHALL return 401

#### Scenario: Token without audience claim is rejected
- **WHEN** a request arrives with a JWT that has no `aud` claim
- **THEN** `jwt.decode()` SHALL raise `MissingRequiredClaimError`
- **AND** the middleware SHALL return 401

### Requirement: Verification parameters are consistent between backend and worker
The backend (PyJWT) and worker (jose) SHALL use identical verification parameters: `audience = WORKOS_CLIENT_ID`, `issuer = "https://api.workos.com"`, `algorithms = ["RS256"]`. Both SHALL use the same JWKS endpoint: `https://api.workos.com/sso/jwks/{WORKOS_CLIENT_ID}`.

#### Scenario: Backend and worker accept the same valid token
- **WHEN** a valid WorkOS access token is presented to either the backend middleware or the worker middleware
- **THEN** both SHALL accept it
- **AND** both SHALL reject the same invalid token

#### Scenario: JWKS endpoint is shared
- **WHEN** the backend constructs its `PyJWKClient` and the worker constructs its `createRemoteJWKSet`
- **THEN** both SHALL point to `https://api.workos.com/sso/jwks/{WORKOS_CLIENT_ID}`
