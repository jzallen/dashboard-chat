## Why

A security review of the WorkOS auth integration revealed that while the refresh infrastructure (from `token-refresh-flow`) is functional and well-structured, it deviates from WorkOS best practices in several areas: JWT verification skips audience and issuer validation, the authorize URL omits required OAuth2 security parameters, logout doesn't revoke server-side sessions, the refresh retry timing guarantees rate-limiter collisions in dev mode, and two frontend code paths bypass the standard 401 recovery flow. Additionally, the worker makes a network round-trip to the backend on every request for token validation that could be done locally.

## What Changes

- **JWT verification hardened** with audience and issuer validation enabled in `jwt.decode()`, closing the token-from-another-app acceptance gap
- **Authorize URL hardened** with `scope`, `nonce`, and `state` parameters; `redirect_uri` added to code exchange request per OAuth2 spec
- **Logout revokes server-side session** via WorkOS session revocation API before clearing client state, preventing silent re-authentication after logout
- **Refresh retry timing fixed** — non-429 retry delay increased from 5s to 12s to clear the 10s rate-limiter window; proactive refresh timer disabled in dev mode to eliminate 401/429 noise
- **Inconsistent 401 handling fixed** — ChatContext SSE retry calls `hardLogout` on final failure instead of leaving the user in a broken-but-authenticated state; `logTurn()` uses `withAuthRetry` instead of raw fetch
- **Worker local JWT verification** replaces per-request `/api/auth/me` calls with cached JWKS-based `jose` verification, eliminating a network round-trip on every SSE message, session create, and turn log
- **Token storage migrated to httpOnly cookies** — refresh token moved from localStorage to a `secure; httpOnly; SameSite=Lax` cookie managed by the backend, preventing XSS exfiltration of the highest-risk credential **BREAKING**

## Capabilities

### New Capabilities
- `jwt-verification`: Backend JWT decode with audience and issuer enforcement; shared verification parameters between backend WorkOS provider and worker JWKS validation
- `oauth-authorize-flow`: Authorize URL construction with `scope`, `nonce`, `state`, and CSRF verification on callback; `redirect_uri` in code exchange
- `session-revocation`: Server-side WorkOS session revocation on logout; frontend logout calls backend before clearing client state; graceful degradation if revocation fails
- `worker-jwt`: Worker-local JWT verification via `jose` and cached JWKS; eliminates backend round-trip for token validation; falls back to 401 on any verification failure
- `secure-token-storage`: Refresh token stored in httpOnly secure cookie set by backend; frontend no longer handles refresh token directly; access token remains in memory for API calls

### Modified Capabilities
- `token-refresh`: Retry delay increased to clear rate-limiter window; proactive refresh timer skipped in dev mode; `ensureFreshToken` timing aligned with backend rate limiter
- `chat-stream-resilience`: SSE 401 retry calls `hardLogout` on final failure instead of falling through to generic error; `logTurn` gains `withAuthRetry` for auth recovery
- `activity-check`: Inactivity logout calls backend revocation endpoint before clearing client state (inherits session-revocation behavior)

## Impact

**Backend (3 files modified):**
- `backend/app/auth/workos_provider.py` — `verify_token` adds audience/issuer to `jwt.decode()`; `get_login_url` adds scope/nonce/state params; `handle_callback` adds redirect_uri to exchange; new `revoke_session` method; `get_logout_url` returns WorkOS revocation flow
- `backend/app/routers/auth.py` — Login route returns state for CSRF verification; logout route calls session revocation before returning; callback optionally verifies state
- `backend/app/auth/middleware.py` — No structural changes; PUBLIC_PATHS unchanged

**Frontend (4 files modified):**
- `frontend/src/lib/api/fetchUtils.ts` — Non-429 retry delay changed from 5s to 12s; `hardLogout` and `withAuthRetry` confirmed exported
- `frontend/src/lib/auth/AuthContext.tsx` — Proactive refresh timer skipped in dev mode; `logout()` calls backend revocation endpoint before clearing localStorage
- `frontend/src/lib/ui/context/ChatContext.tsx` — SSE 401 retry calls `hardLogout` on final failure
- `frontend/src/lib/api/sessions.ts` — `logTurn()` uses `withAuthRetry` instead of raw fetch

**Worker (2 files modified, 1 dependency added):**
- `worker/lib/auth.ts` — Production path replaced with `jose` `jwtVerify` against cached JWKS; `WORKOS_CLIENT_ID` env var required
- `worker/lib/auth.test.ts` — New production-mode tests with mocked jose
- `package.json` — `jose` added to worker workspace

**Infrastructure:**
- `docker-compose.yml` — `WORKOS_CLIENT_ID` added to worker service environment

**Database:** No migrations. Auth remains stateless JWT-based.

**API contract:**
- Login response gains `state` field (additive, non-breaking)
- Logout becomes an active operation (calls WorkOS API) but response shape unchanged
- **BREAKING**: Secure token storage changes how refresh tokens are delivered (cookie vs JSON body) — requires coordinated frontend/backend deployment
