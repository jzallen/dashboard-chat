# WorkOS Auth Hardening

## Context

A full review of the WorkOS auth integration (backend, frontend, worker) revealed security gaps, legacy API usage, and behavioral bugs. The implementation is functional and well-structured, but deviates from current WorkOS best practices in several areas.

The review was prompted by 401/429 errors on the `/api/auth/refresh` endpoint in dev mode.

## 1. JWT Verification Gaps

`workos_provider.py` disables audience verification (`verify_aud: False`) and does not check the issuer claim. This means:

- A token issued for a different WorkOS application could be accepted
- A token from an unexpected issuer could pass verification

**Fix**: Enable `verify_aud: True` with `audience=client_id` and add `issuer` validation in the `jwt.decode()` call. The Connect/OAuth2 surface always includes `aud` in access tokens.

**Files**: `backend/app/auth/workos_provider.py:38`

## 2. Legacy API Surface Migration

The implementation mixes two WorkOS API surfaces:

- **Token exchange/refresh**: Legacy `/user_management/authenticate` endpoint with proprietary grant type `urn:workos:oauth:grant-type:refresh-token`
- **JWKS verification**: SSO endpoint `/sso/jwks/{client_id}`

WorkOS now provides a unified Connect/OAuth2 surface (`authkit.app/oauth2/*`) with standard endpoints for authorize, token exchange, JWKS, and logout. The legacy endpoints still function but should be migrated.

Related issues in the authorize URL:
- Missing `nonce` parameter (required — prevents replay attacks)
- Missing `scope` parameter (required for Connect/OAuth2)
- Missing `redirect_uri` in code exchange request
- No PKCE support (`code_challenge`/`code_challenge_method`)

**Files**: `backend/app/auth/workos_provider.py`

## 3. Session Lifecycle

### Logout doesn't revoke WorkOS session

Both backend (`get_logout_url` returns `"/"`) and frontend (`logout()` only clears localStorage) skip server-side session revocation. After "logout", the user's WorkOS session remains active — navigating back to login auto-authenticates without credentials.

WorkOS provides session revocation via `/sessions/revoke` or AuthKit's logout URL.

### Inactivity timeout is client-side only

The `ActivityCheckModal` tracks 20-minute inactivity and prompts the user, but there is no corresponding server-side session invalidation.

**Files**: `backend/app/auth/workos_provider.py:127`, `frontend/src/lib/auth/AuthContext.tsx:84-91`

## 4. Token Storage

Access and refresh tokens are stored in `localStorage`, accessible to any JavaScript on the page. WorkOS documentation recommends `httpOnly`, `secure` cookies (e.g., a sealed `wos-session` cookie) to prevent XSS exfiltration.

This is the largest migration effort — it requires the backend to manage session cookies and the frontend to stop handling tokens directly. The refresh token is the highest-risk item since it can mint new access tokens.

**Files**: `frontend/src/lib/api/fetchUtils.ts`, `frontend/src/lib/auth/AuthContext.tsx`

## 5. Refresh Retry / Rate Limiter Mismatch

When a refresh attempt fails, the frontend retries after 5 seconds. The backend rate limiter has a 10-second window. This guarantees a 429 on every retry after a failure, creating a 401 → 429 cascade visible in logs.

Additionally in dev mode, the proactive refresh timer is unnecessary — `dev-token-static` never expires server-side, so refresh calls are pure noise.

**Fix**: Either increase the frontend retry delay to >10s or reduce the rate limiter window. Consider skipping proactive refresh entirely in dev mode.

**Files**: `frontend/src/lib/api/fetchUtils.ts:87` (5s retry), `backend/app/auth/rate_limiter.py` (10s window)

## 6. Inconsistent 401 Handling

Two code paths lack the standard `withAuthRetry` / `hardLogout` behavior:

- **ChatContext SSE** (`ChatContext.tsx:167-188`): Has its own inline 401 retry that does not call `hardLogout` on failure. If SSE refresh fails, the user stays authenticated in the UI but chat is broken.
- **`logTurn()`** (`sessions.ts:54-64`): Does not use `handleResponse`/`withAuthRetry` at all. A 401 during turn logging silently fails without attempting refresh.

**Files**: `frontend/src/lib/ui/context/ChatContext.tsx`, `frontend/src/lib/api/sessions.ts`

## 7. Worker Token Validation

The worker validates every request by calling the backend's `/api/auth/me` endpoint — a network round-trip on every SSE message, session create, and turn log. WorkOS provides JWKS for local JWT verification, which the worker could use (with caching) to eliminate this latency.

**Files**: `worker/lib/auth.ts`

## Suggested Priority

| Priority | Item | Effort |
|----------|------|--------|
| P0 | JWT audience + issuer verification (#1) | Small |
| P0 | Refresh retry / rate limiter fix (#5) | Small |
| P1 | Authorize URL hardening — nonce, scope (#2) | Small |
| P1 | Logout session revocation (#3) | Medium |
| P1 | Inconsistent 401 handling (#6) | Small |
| P2 | Legacy → Connect/OAuth2 migration (#2) | Medium |
| P2 | Worker local JWT verification (#7) | Medium |
| P3 | Token storage → httpOnly cookies (#4) | Large |

## Status

Backlog — pending solutions architecture review.
