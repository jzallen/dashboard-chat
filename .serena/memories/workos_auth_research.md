# WorkOS Auth Backend Implementation Research

## JWT Verification (workos_provider.py:30-55)

### jwt.decode() call (lines 36-42)
```python
payload = jwt.decode(
    token,
    signing_key.key,
    algorithms=["RS256"],
    audience=self.client_id,
    issuer="https://api.workos.com",
)
```

**Key details:**
- Algorithm: RS256 (asymmetric)
- Audience validation: ENABLED (checks against `self.client_id`)
- Issuer validation: ENABLED (hardcoded to "https://api.workos.com")
- Signature verification: ENABLED (via signing_key.key from JWKS)

### JWT Claims Extraction (lines 49-55)
```python
return AuthUser(
    id=payload.get("sub", ""),                 # subject claim
    email=payload.get("email", ""),            # email claim
    org_id=payload.get("org_id") or None,      # org_id claim (WorkOS-specific)
    name=payload.get("first_name", ""),        # first_name claim
    org_name=payload.get("org_name") or None,  # org_name claim (WorkOS-specific)
)
```

### JWKS URL (line 27)
```python
PyJWKClient(f"https://api.workos.com/sso/jwks/{self.client_id}")
```

**Endpoint type:** SSO JWKS endpoint
**URL pattern:** https://api.workos.com/sso/jwks/{client_id}
**Key rotation:** Handled automatically by PyJWKClient (caches and refreshes as needed)

## Auth Provider Protocol (provider.py)

```python
class AuthProvider(Protocol):
    async def verify_token(self, token: str) -> AuthUser: ...
    async def get_login_url(self, redirect_uri: str, *, organization_id: str | None = None) -> tuple[str, str]: ...
    async def handle_callback(self, code: str) -> tuple[AuthUser, str, str, int]: ...
    async def refresh_access_token(self, refresh_token: str) -> tuple[AuthUser, str, str, int]: ...
    async def get_logout_url(self) -> str: ...
```

**Return types:**
- `verify_token`: AuthUser
- `get_login_url`: tuple[url, state] where state is CSRF token
- `handle_callback`: tuple[AuthUser, access_token, refresh_token, expires_in]
- `refresh_access_token`: tuple[AuthUser, access_token, refresh_token, expires_in]
- `get_logout_url`: logout redirect URL string

## Auth Routes (routers/auth.py)

### Login (GET /api/auth/login)
**Query params:** `redirect_uri` (optional), `organization_id` (optional)
**Response:**
```json
{
  "url": "https://api.workos.com/user_management/authorize?client_id=...",
  "state": "csrf-token"
}
```

### Callback (POST /api/auth/callback)
**Request body:** `{"code": "authorization-code"}`
**Response (success):**
```json
{
  "user": {
    "id": "user_01ABC",
    "email": "alice@example.com",
    "org_id": "org_01XYZ",
    "name": "Alice"
  },
  "token": "access-token",
  "refresh_token": "refresh-token",
  "expires_in": 3600
}
```
**Response (failure):** 401 with error detail

**Side effects:**
- Calls `enrich_org_id()` to look up org_id from local DB if JWT missing it
- Calls `ensure_org_provisioned()` to auto-create org + project (if `auto_provision_org=True`)

### Refresh (POST /api/auth/refresh)
**Request body:** `{"refresh_token": "..."}`
**Rate limiting:** InMemoryRateLimiter with 10-second window per client IP
**Response (success):**
```json
{
  "access_token": "new-token",
  "refresh_token": "new-refresh-token",
  "expires_in": 1800
}
```
**Response (rate limited):** 429 "Too many refresh requests"
**Response (invalid):** 401 "Refresh token invalid or expired"

### Logout (POST /api/auth/logout)
**Request:** Authorization header with access token (Bearer token)
**Response:**
```json
{
  "url": "/"
}
```
**Side effects:**
- Best-effort server-side session revocation via WorkOS revoke endpoint
- Never raises; swallows exceptions so logout always succeeds
- Logs warnings on revocation failure

### Me (GET /api/auth/me)
**Auth:** Requires valid Bearer token
**Response (authenticated):**
```json
{
  "id": "user_01ABC",
  "email": "alice@example.com",
  "org_id": "org_01XYZ",
  "name": "Alice"
}
```
**Response (not authenticated):** 401 "Not authenticated"

## WorkOS Authenticate Endpoint (workos_provider.py:93-108)

### handle_callback request
**Endpoint:** POST https://api.workos.com/user_management/authenticate
**Request body:**
```json
{
  "client_id": "client_xyz",
  "client_secret": "sk_test_abc123",
  "code": "authorization-code",
  "grant_type": "authorization_code",
  "redirect_uri": "http://localhost:5173/auth/callback"
}
```

### Response parsing (_parse_auth_response, lines 74-91)
**Response expected:**
```json
{
  "user": {
    "id": "user_01ABC",
    "email": "alice@example.com",
    "first_name": "Alice"
  },
  "access_token": "eyJ0eXAi...",
  "refresh_token": "refresh_xyz",
  "organization_id": "org_01XYZ",    // optional
  "organization_name": "ACME Inc."   // optional
}
```

**Expiry calculation (lines 88-90):**
- Decodes access_token WITHOUT signature verification: `jwt.decode(token, options={"verify_signature": False})`
- Extracts exp claim: `decoded["exp"] - int(time.time())`
- Returns expires_in as seconds remaining

## Token Refresh (workos_provider.py:110-124)

**Endpoint:** POST https://api.workos.com/user_management/authenticate
**Grant type:** `urn:workos:oauth:grant-type:refresh-token`
**Request body:**
```json
{
  "client_id": "client_xyz",
  "client_secret": "sk_test_abc123",
  "refresh_token": "refresh_xyz",
  "grant_type": "urn:workos:oauth:grant-type:refresh-token"
}
```

**Response:** Same as callback authenticate response

## Session Revocation (workos_provider.py:126-142)

**Endpoint:** POST https://api.workos.com/user_management/sessions/revoke
**Request headers:** `Authorization: Bearer {api_key}`
**Request body:** `{"session_id": access_token}`
**Timeout:** 5 seconds
**Error handling:** Best-effort, logs warnings but never raises
**Expected status codes:** 200, 204 acceptable; others logged as warnings

## Get Login URL (workos_provider.py:57-72)

**Endpoint:** https://api.workos.com/user_management/authorize
**Query parameters:**
```
client_id=client_xyz
redirect_uri=http://localhost:5173/auth/callback
response_type=code
provider=authkit
scope=openid profile email
nonce=<32-byte random>
state=<32-byte random CSRF token>
organization=org_01XYZ  // optional, only if organization_id provided
```

**Scope:** Fixed to "openid profile email" (hardcoded)

## Get Logout URL (workos_provider.py:144-145)

**Current implementation:** Returns "/" (no actual logout URL from WorkOS)

## Configuration (config.py:50-55)

```python
auth_mode: str = "dev"  # "dev" or "workos"
auto_provision_org: bool = False  # auto-create org + project on login
workos_api_key: str = ""
workos_client_id: str = ""
workos_redirect_uri: str = "http://localhost:5173/auth/callback"
```

## Auth Middleware (middleware.py:26-68)

**Public paths (no token required):**
- /health
- /
- /docs, /openapi.json, /redoc
- /api/auth/login, /api/auth/callback, /api/auth/logout, /api/auth/refresh

**Org-less paths (authenticated but org_id can be None):**
- /api/orgs, /api/orgs/me

**Flow:**
1. Extract Bearer token from Authorization header
2. Call `provider.verify_token(token)`
3. Call `enrich_org_id(user)` to look up from DB if needed
4. Set auth context via `set_auth_user(user)`
5. Return 403 if user.org_id is None and path not in ORG_LESS_PATHS

## Rate Limiting (rate_limiter.py)

**Implementation:** InMemoryRateLimiter with 10-second window
**Key:** Client IP
**Behavior:**
- First request in window: allowed
- Second+ request in window: blocked (returns False)
- After window: allowed again
- Stale entries cleaned automatically (10x window age)

## Organization Creation (use_cases/organization/create_organization.py)

**WorkOS flow:**
1. POST https://api.workos.com/organizations with `{"name": name}`
2. Extract org_id from response
3. POST https://api.workos.com/user_management/organization_memberships
4. Create local org record with WorkOS org_id
5. Return org_id with `requires_reauth: True` (frontend must re-login)

## Test Coverage

### test_workos_provider.py (6 test classes, 13 tests)
- **TestVerifyToken** (4 tests): valid JWT, expired JWT, invalid JWT, missing org_id
- **TestGetLoginUrl** (3 tests): required params, organization inclusion, organization omission
- **TestHandleCallback** (3 tests): successful callback, failed callback, missing org_id
- **TestRefreshAccessToken** (2 tests): successful refresh, failed refresh
- **TestGetLogoutUrl** (1 test): returns "/"

### test_auth_routes.py (4 test classes, 14 tests)
- **TestCallbackResponse** (2 tests): includes refresh_token/expires_in, auth error returns 401
- **TestRefreshEndpoint** (4 tests): successful refresh, invalid token, rate limiting, window expiry
- **TestRateLimiter** (4 tests): first request allowed, second blocked, different keys independent, stale cleanup
- Fixtures mock httpx, JWKS, and DB helpers

### test_dev_provider.py (2 test classes, 8 tests)
- **TestDevAuthProvider** (4 tests): verify token (valid, invalid, empty), handle_callback, get_login_url, get_logout_url
- **TestDevRefreshAccessToken** (4 tests): counter increment, rollover, invalid prefix, non-numeric suffix

### test_middleware.py (1 test class, 8 tests)
- Public paths: /health, /, /docs, /api/auth/login
- Protected: missing token (401), invalid token (401), valid dev token (passes)

### test_context.py (1 test class, 6 tests)
- Raises when not set, set/get roundtrip, frozen dataclass, context var isolation, default name=None

## WorkOS API Endpoints Identified

1. **SSO/JWKS:** `GET https://api.workos.com/sso/jwks/{client_id}`
2. **Authorization:** `GET https://api.workos.com/user_management/authorize?{params}`
3. **Authenticate:** `POST https://api.workos.com/user_management/authenticate`
4. **Refresh:** `POST https://api.workos.com/user_management/authenticate` (same endpoint, different grant_type)
5. **Sessions Revoke:** `POST https://api.workos.com/user_management/sessions/revoke`
6. **Organizations Create:** `POST https://api.workos.com/organizations`
7. **Organization Memberships:** `POST https://api.workos.com/user_management/organization_memberships`

All use **User Management** API, not legacy SSO. The JWKS is from SSO endpoint only.

## Key Security Observations

1. **Token validation:** Fully validated (signature + audience + issuer)
2. **Refresh rate limiting:** Applied per IP in 10-second windows
3. **Session revocation:** Best-effort, never blocks logout
4. **Org enrichment:** Fallback to local DB when JWT missing org_id
5. **Auto-provisioning:** Gated on `auto_provision_org` flag (default False)
6. **CSRF protection:** Nonce + state tokens on login flow
7. **API key handling:** Passed as Bearer header to WorkOS APIs

## Known Limitations/TODOs

1. Logout URL hardcoded to "/" (no WorkOS logout endpoint called)
2. Auto-provisioning creates org but triggers `requires_reauth` on frontend
3. CORS origins configurable but defaults to localhost:5173,3000
4. No PKCE on authorization flow (currently using code + state only)
