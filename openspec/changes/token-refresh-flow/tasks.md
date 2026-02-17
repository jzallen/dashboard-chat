## 1. Backend: AuthProvider Protocol and Provider Updates

- [ ] 1.1 Update AuthProvider protocol in backend/app/auth/provider.py: change handle_callback return type from tuple[AuthUser, str] to tuple[AuthUser, str, str, int] and add refresh_access_token(self, refresh_token: str) -> tuple[AuthUser, str, str, int] method
- [ ] 1.2 Update WorkOSAuthProvider.handle_callback in backend/app/auth/workos_provider.py: extract refresh_token from WorkOS response, decode JWT exp claim to compute expires_in, return 4-tuple (user, access_token, refresh_token, expires_in)
- [ ] 1.3 Implement WorkOSAuthProvider.refresh_access_token in backend/app/auth/workos_provider.py: POST to WorkOS authenticate with grant_type refresh-token, client_id, client_secret, refresh_token; decode new JWT exp claim; return 4-tuple
- [ ] 1.4 Update DevAuthProvider.handle_callback in backend/app/auth/dev_provider.py: return (DEV_USER, DEV_TOKEN, "dev-refresh-token-001", 300) instead of (DEV_USER, DEV_TOKEN)
- [ ] 1.5 Implement DevAuthProvider.refresh_access_token in backend/app/auth/dev_provider.py: parse counter from input token suffix, return incremented token; raise AuthenticationError if prefix does not match dev-refresh-token-
- [ ] 1.6 Write unit tests for WorkOSAuthProvider.refresh_access_token (mock WorkOS HTTP call, verify JWT decoding, verify return shape)
- [ ] 1.7 Write unit tests for DevAuthProvider.refresh_access_token (valid token increment, invalid prefix rejection)

## 2. Backend: Refresh Endpoint and Rate Limiter

- [ ] 2.1 Create in-memory rate limiter module (dict with IP-keyed timestamps, 1 req/IP/10s, lazy cleanup of stale entries)
- [ ] 2.2 Add POST /api/auth/refresh endpoint in backend/app/routers/auth.py: accept { refresh_token: string }, call rate limiter, call provider.refresh_access_token, return { access_token, refresh_token, expires_in } or 401/429
- [ ] 2.3 Add /api/auth/refresh to PUBLIC_PATHS in backend/app/auth/middleware.py
- [ ] 2.4 Update callback endpoint in backend/app/routers/auth.py: unpack 4-tuple from provider.handle_callback, include refresh_token and expires_in in response
- [ ] 2.5 Write integration tests for POST /api/auth/refresh endpoint (success, invalid token 401, rate limit 429)
- [ ] 2.6 Write integration test for updated POST /api/auth/callback response shape (verify refresh_token and expires_in fields present)

## 3. Frontend: Auth Types and Storage

- [ ] 3.1 Add refreshToken: string | null and tokenExpiresAt: number | null to AuthState in frontend/src/lib/auth/types.ts
- [ ] 3.2 Add REFRESH_TOKEN_KEY and EXPIRES_AT_KEY constants to frontend/src/lib/api/fetchUtils.ts
- [ ] 3.3 Update AuthProvider mount logic in AuthContext.tsx to restore refreshToken and tokenExpiresAt from localStorage on mount
- [ ] 3.4 Update handleCallback in AuthContext.tsx to store auth_refresh_token and auth_token_expires_at in localStorage from callback response (expires_in converted to absolute timestamp)
- [ ] 3.5 Update logout in AuthContext.tsx to clear all four localStorage keys
- [ ] 3.6 Update dev mode auto-auth in AuthContext.tsx to set simulated refresh token and expiry (dev-refresh-token-001, Date.now() + 300000)

## 4. Frontend: Proactive Refresh Timer

- [ ] 4.1 Create refreshTokens async function in AuthContext.tsx: call POST /api/auth/refresh with stored refresh token, update localStorage and AuthState on success
- [ ] 4.2 Add useEffect in AuthProvider that sets a setTimeout at 80% of TTL calling refreshTokens; clear on unmount or logout
- [ ] 4.3 Implement single-retry logic in timer callback: on refresh failure, wait 5 seconds, retry once; if retry fails, call logout()
- [ ] 4.4 Ensure the timer resets after each successful refresh (new setTimeout with new TTL)
- [ ] 4.5 Write unit tests for refresh timer (mock POST /api/auth/refresh, verify timer setup at 80% TTL, verify retry-once-then-logout on failure)

## 5. Frontend: 401 Interceptor with Coalesced Refresh

- [ ] 5.1 Create shared ensureFreshToken function in fetchUtils.ts: module-level refreshPromise singleton, calls POST /api/auth/refresh, updates localStorage, returns new access token; coalesces concurrent calls
- [ ] 5.2 Refactor handleResponse in client.ts: on 401, check for refresh token; if present, call ensureFreshToken(), replay original request with new token; if no refresh token or refresh fails, hard logout
- [ ] 5.3 Refactor handleResponse in fetchUtils.ts: same 401 handling, delegating to the same ensureFreshToken()
- [ ] 5.4 Add guard against infinite retry: if a replayed request also returns 401, do NOT attempt another refresh -- proceed to hard logout
- [ ] 5.5 Ensure handleResponse in both modules receives original request parameters (URL, method, headers, body) so it can replay the request
- [ ] 5.6 Write unit tests for 401 interceptor (single 401 recovery, concurrent 401 coalescing, refresh failure logout, no infinite loop)

## 6. Frontend: ActivityCheckModal Component

- [ ] 6.1 Create ActivityCheckModal.tsx in frontend/src/lib/ui/components/: modal with "Are you still there?" text, "Continue" button, "Log Out" button, 5-minute auto-logout timer
- [ ] 6.2 Implement accessibility: role=dialog, aria-modal=true, focus trap, screen reader announcement on open
- [ ] 6.3 Style with Tailwind CSS: overlay backdrop, centered card, consistent with existing UI patterns
- [ ] 6.4 Add inactivity tracking to AuthProvider in AuthContext.tsx: register passive event listeners for mousedown, keydown, scroll, touchstart on document; update lastActivity ref; setInterval every 60s checks if inactivity exceeds 60 minutes
- [ ] 6.5 Integrate ActivityCheckModal into AuthProvider: render modal when inactivity threshold exceeded; Continue resets timer and dismisses; Log Out calls logout(); 5-minute timeout calls logout()
- [ ] 6.6 Ensure modal does NOT block refresh timer (independent useEffect hooks)
- [ ] 6.7 Clean up event listeners and intervals on AuthProvider unmount
- [ ] 6.8 Write unit tests for ActivityCheckModal (renders correctly, Continue resets timer, Log Out triggers logout, 5-minute auto-logout, does not dismiss on outside click/keypress)

## 7. Frontend: Chat Stream Resilience

- [ ] 7.1 Add pre-stream token freshness check in ChatContext.tsx handleSubmit: before fetch, read auth_token_expires_at from localStorage; if token expires within 60 seconds, call ensureFreshToken() and use returned token
- [ ] 7.2 Add 401 retry for stream setup: if initial fetch returns 401 (before response.body is read), call ensureFreshToken() and retry fetch once
- [ ] 7.3 Update handleSubmit to use fresh token from ensureFreshToken() in the Authorization header
- [ ] 7.4 Write unit tests for pre-stream token check (near-expiry triggers refresh, fresh token skips refresh, stream setup 401 retries once)

## 8. Verification and Cleanup

- [ ] 8.1 Run full backend test suite (cd backend && uv run pytest) and verify no regressions
- [ ] 8.2 Run full frontend test suite (cd frontend && npx vitest run) and verify no regressions
- [ ] 8.3 Manual smoke test in dev mode: verify refresh timer fires, activity modal appears after idle, 401 recovery works, chat stream pre-check works
- [ ] 8.4 Verify Gherkin scenarios in features/token-refresh.feature align with implementation (note deviations from architect rulings: 5min modal timeout not 2min, explicit buttons only not any interaction, 1 retry not 3 with backoff)
