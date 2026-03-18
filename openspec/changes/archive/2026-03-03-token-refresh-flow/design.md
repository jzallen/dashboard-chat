## Context

Dashboard Chat uses stateless JWT auth via WorkOS. The current auth flow:

1. Frontend redirects to WorkOS login via `GET /api/auth/login`
2. WorkOS redirects back with an auth code
3. Frontend posts code to `POST /api/auth/callback`
4. Backend exchanges code with WorkOS, returns `{ user, token }`
5. Frontend stores `auth_token` and `auth_user` in localStorage
6. Every API call includes `Authorization: Bearer <token>`
7. On any 401, both `client.ts` and `fetchUtils.ts` immediately clear localStorage and redirect to `/login`

**Problem**: WorkOS access tokens expire in ~5 minutes. The refresh token returned by WorkOS is discarded in `workos_provider.py` line 100. There is no renewal mechanism, so users are hard-logged-out after ~5 minutes of inactivity or mid-action if a token expires.

**Current auth files**:
- Backend protocol: `AuthProvider` in `backend/app/auth/provider.py` -- 4 methods, `handle_callback` returns `tuple[AuthUser, str]`
- WorkOS implementation: `backend/app/auth/workos_provider.py` -- `handle_callback` discards `data["refresh_token"]`
- Dev implementation: `backend/app/auth/dev_provider.py` -- static `DEV_TOKEN = "dev-token-static"`, no expiry concept
- Middleware: `backend/app/auth/middleware.py` -- `PUBLIC_PATHS` set, JWT verification on all other routes
- Auth routes: `backend/app/routers/auth.py` -- callback returns `{ user, token }`
- Frontend auth: `frontend/src/lib/auth/AuthContext.tsx` -- stores token + user in localStorage
- Frontend API: `client.ts` and `fetchUtils.ts` both have independent 401 handlers that do hard logout
- Chat streaming: `ChatContext.tsx` -- `fetch()` with `getAuthHeaders()`, no token freshness check

**Constraints**:
- No Redis for auth (worker uses ioredis for chat sessions, but backend has no Redis dependency)
- No database schema changes (stateless JWT auth, no session table)
- Must work in dev mode (`AUTH_MODE=dev`) with same code paths
- Worker (`worker/lib/auth.ts`) validates by calling `GET /api/auth/me` -- no worker changes needed for v1

**Stakeholders**: All authenticated users. Impacts every API call and SSE stream.

**Reference docs**:
- BA requirements: `docs/backlog/token-refresh-flow.md` (4 user stories, 8 business rules, 12 functional requirements)
- Gherkin scenarios: `features/token-refresh.feature` (18 scenarios)

## Goals / Non-Goals

**Goals:**
- Seamless background token refresh at 80% of TTL -- users never see expiry during normal use
- Reactive 401 recovery with coalesced refresh and transparent request replay
- Inactivity detection after 60 minutes with 5-minute confirmation window
- Pre-stream token freshness check for chat SSE connections
- Dev mode exercises identical code paths with simulated TTL
- Backend acts as stateless proxy to WorkOS for refresh token exchange

**Non-Goals:**
- Server-side refresh token storage (relay model only for v1)
- Multi-tab token synchronization (each tab independent)
- httpOnly cookie storage (localStorage for v1, consistent with current `auth_token` storage)
- Mid-stream 401 recovery (streams are short-lived, typically <30s)
- Worker-side refresh flow
- Refresh token revocation on logout (rely on WorkOS session management)
- Redis-backed rate limiting (in-memory for v1)

## Decisions

### D1: Backend Proxy for Token Refresh (not direct WorkOS calls from frontend)

**Decision**: Frontend calls `POST /api/auth/refresh` on our backend, which proxies to WorkOS.

**Rationale**: The WorkOS `client_secret` (`workos_api_key` in our config) is required for the refresh grant. This secret must never be exposed to browser JavaScript. The backend already holds this secret for the callback flow.

**Alternative considered**: Direct WorkOS refresh from frontend. Rejected because it would require exposing `client_secret` to the browser, which is a critical security violation.

### D2: localStorage for Refresh Token Storage (not httpOnly cookies)

**Decision**: Store `refresh_token` in localStorage alongside existing `auth_token`.

**Rationale**: Consistent with current auth storage pattern. `auth_token` is already in localStorage. Adding httpOnly cookies would require backend cookie management, CSRF protection (SameSite + CSRF token), and changes to the CORS configuration. The XSS risk is mitigated by existing CSP headers.

**Alternative considered**: httpOnly cookies. Deferred to v2 -- would require significant backend changes (cookie middleware, CSRF tokens, SameSite configuration) that are out of scope.

### D3: In-Memory Rate Limiter (not Redis)

**Decision**: Simple in-memory dict with IP-keyed timestamps for the refresh endpoint rate limit.

**Rationale**: The backend has no Redis dependency today. The rate limiter only needs to prevent rapid-fire refresh abuse. An in-memory approach with cleanup on each request is sufficient for single-instance deployment. The limiter resets on deploy, which is acceptable.

**Implementation**: A dict `{ip: last_refresh_timestamp}`. On each request, check if `now - last_refresh > 10s`. Stale entries cleaned up lazily. Max 1 refresh per IP per 10 seconds.

**Alternative considered**: Redis-based rate limiting. Overkill for v1 single-instance deployment. Would add a new backend dependency for a single endpoint.

### D4: JWT exp Claim for expires_in (not WorkOS response field)

**Decision**: Decode the JWT `exp` claim and compute `expires_in = exp - int(time.time())`.

**Rationale**: The backend already decodes JWTs (in `workos_provider.py` for `verify_token`). The `exp` claim is always present in WorkOS JWTs. This is more reliable than depending on WorkOS including an `expires_in` field in the authenticate response, which is not documented as guaranteed.

### D5: Inactivity-Based Activity Check (not fixed interval from login)

**Decision**: Track last user interaction (keypress, mouse move, click). Fire modal after 60 minutes of no interaction.

**Rationale**: A fixed interval from login would prompt a user who is actively clicking and typing, which is disruptive. Inactivity-based detection only prompts when the user has genuinely stopped interacting.

**Implementation**: Register passive event listeners for `mousedown`, `keydown`, `scroll`, `touchstart` on `document`. Update a `lastActivity` timestamp. A `setInterval` checks every 60s whether `now - lastActivity > 60min`.

### D6: Modal Dismissal via Explicit Button Clicks Only

**Decision**: The "Are you still there?" modal can only be dismissed by clicking "Continue" or "Log Out". Not by any keypress, mouse move, or clicking outside.

**Rationale**: Random mouse movements or accidental keypresses should not silently extend a session that may be abandoned. The user must make a deliberate choice.

### D7: Single Retry on Refresh Failure (not exponential backoff)

**Decision**: On refresh failure, wait 5 seconds, retry once. If the retry also fails, force logout.

**Rationale**: If WorkOS rejects a refresh token, it is almost certainly because the session is revoked or the token is stale -- retrying more times will not help. A single 5-second delay handles transient network blips without adding complexity.

**Alternative considered**: 3 retries with exponential backoff (as in the Gherkin spec scenario). Overruled by architect -- adds complexity for minimal benefit. A revoked token will fail every time.

### D8: Coalesced 401 Interceptor Pattern

**Decision**: Module-level promise singleton that deduplicates concurrent refresh attempts.

**Implementation**:
```typescript
let refreshPromise: Promise<string> | null = null;

async function ensureFreshToken(): Promise<string> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = doRefresh().finally(() => { refreshPromise = null; });
  return refreshPromise;
}
```

When a 401 is received: (1) if no refresh in flight, start one and queue the failed request; (2) if refresh already in flight, just queue; (3) on refresh success, replay all queued requests with new token; (4) on refresh failure, hard logout.

**Rationale**: TanStack Query may fire multiple queries simultaneously (e.g., project + dataset on mount). If the token expires, all will get 401. Without coalescing, we'd make N refresh calls, and N-1 would fail because WorkOS refresh tokens are single-use with rotation.

### D9: AuthProvider Protocol Extension (backward-compatible tuple expansion)

**Decision**: Change `handle_callback` return from `tuple[AuthUser, str]` to `tuple[AuthUser, str, str, int]` and add `refresh_access_token` method.

**Rationale**: Both providers (WorkOS, dev) are internal to this project -- there are no external consumers. The protocol change is a clean way to enforce the contract.

**Impact**: Both `WorkOSAuthProvider` and `DevAuthProvider` must be updated in the same commit. The `callback` route in `auth.py` unpacks the new tuple. No migration needed.

## Component Architecture

### Backend: Refresh Endpoint Flow

```
POST /api/auth/refresh
  │
  ├── Rate limiter check (in-memory, 1 req/IP/10s)
  │     └── 429 if exceeded
  │
  ├── Extract refresh_token from request body
  │
  ├── Call provider.refresh_access_token(refresh_token)
  │     ├── WorkOS: POST to WorkOS authenticate with grant_type=refresh
  │     └── Dev: Return incremented dev-refresh-token-NNN
  │
  ├── Decode new JWT exp claim → compute expires_in
  │
  └── Return { access_token, refresh_token, expires_in }
```

### Frontend: Token Lifecycle State Machine

```
                    ┌─────────────────┐
                    │   LOGGED_OUT    │
                    └───────┬─────────┘
                            │ login/callback
                            ▼
                    ┌─────────────────┐
            ┌──────│    ACTIVE        │◄─────────┐
            │      │ (refresh timer   │          │
            │      │  running)        │          │ refresh
            │      └───────┬─────────┘          │ success
            │              │                     │
            │   401 or     │ timer fires         │
            │   timer      │ (80% TTL)           │
            │              ▼                     │
            │      ┌─────────────────┐          │
            │      │  REFRESHING     ├──────────┘
            │      │ (coalesced)     │
            │      └───────┬─────────┘
            │              │ refresh fails
            │              │ (after 1 retry)
            │              ▼
            │      ┌─────────────────┐
            └─────►│   LOGGED_OUT    │
                   └─────────────────┘
                   
  Parallel track (independent of refresh):
  
      60min inactivity → ACTIVITY_CHECK modal
        ├── "Continue" → reset timer, stay ACTIVE
        ├── "Log Out" → LOGGED_OUT
        └── 5min timeout → LOGGED_OUT
```

### Frontend: 401 Interceptor Sequence

```
  API call returns 401
        │
        ├── Has refresh token? ──── No ──► hard logout
        │
        Yes
        │
        ├── Refresh already in flight? ──── Yes ──► queue request, await refresh
        │
        No
        │
        ├── Start refresh (POST /api/auth/refresh)
        │     │
        │     ├── Success: store new tokens, replay ALL queued requests
        │     │
        │     └── Failure: wait 5s, retry once
        │           │
        │           ├── Success: store new tokens, replay queued
        │           │
        │           └── Failure: hard logout, reject all queued
        │
        └── Queue original request, await refresh
```

## Risks / Trade-offs

### [Risk] Stale refresh token race condition between timer and interceptor
**Scenario**: Timer fires a proactive refresh. Before it completes, a 401 triggers the interceptor which also tries to refresh with the same (now-consumed) token.
**Mitigation**: The coalesced refresh promise (D8) ensures only one refresh is in flight at a time. The interceptor checks `refreshPromise` before starting a new refresh. Both the timer callback and the interceptor use the same `ensureFreshToken()` function.

### [Risk] localStorage accessible to XSS
**Scenario**: An XSS vulnerability allows an attacker to read `auth_refresh_token` from localStorage.
**Mitigation**: Accept for v1 (matches existing `auth_token` storage). CSP headers mitigate injection. httpOnly cookies for v2.
**Trade-off**: Simpler implementation now vs. stronger security later.

### [Risk] In-memory rate limiter resets on deploy
**Scenario**: A deploy clears the rate limiter, allowing a burst of refresh calls.
**Mitigation**: Accept for v1. The rate limiter is defense-in-depth; WorkOS itself rate-limits refresh calls. The burst window is seconds.

### [Risk] Activity modal dismissed by page refresh
**Scenario**: User refreshes browser during modal, resetting the inactivity timer.
**Mitigation**: Accept. A page refresh proves user presence. The timer resets on mount, which is correct behavior.

### [Risk] Dev mode divergence from production
**Scenario**: Refresh logic bugs only manifest with real WorkOS tokens.
**Mitigation**: Dev provider implements same interface with simulated TTL (D9). Same timer/interceptor/modal code runs in dev mode. Integration tests cover the full refresh cycle.

### [Trade-off] No mid-stream 401 recovery
**Decision**: If a token expires during an active SSE stream, the stream fails.
**Rationale**: Streams are typically <30s. The pre-stream check (FR-11) ensures the token is fresh before starting. Mid-stream recovery would require reconnection logic and message deduplication, which is excessive for v1.

## Migration Plan

### Deployment Order

**Phase 1 -- Backend** (deploy independently, no frontend changes needed):
1. Update `AuthProvider` protocol and both providers
2. Add refresh endpoint and update callback response
3. The new `refresh_token` and `expires_in` fields in the callback response are additive -- existing frontend ignores them until updated

**Phase 2 -- Frontend** (deploy after backend is live):
1. Update auth types and AuthContext to handle new callback fields
2. Wire up refresh timer and 401 interceptor
3. Add ActivityCheckModal
4. Add pre-stream token check in ChatContext

### Rollback Strategy

- **Backend rollback**: Revert to previous version. The refresh endpoint disappears. Frontend falls back to hard-logout on 401 (current behavior). No data loss.
- **Frontend rollback**: Revert to previous version. New callback response fields are ignored. Hard-logout resumes. No data loss.
- **No database changes**: No migration rollback needed.

### Feature Flag

Not needed for v1. The change is additive:
- Backend: New endpoint + extended response. Old frontend still works.
- Frontend: Gracefully degrades if refresh endpoint returns error (falls back to hard logout).

## Open Questions

All architect questions have been resolved (see proposal context). No remaining open questions for v1.
