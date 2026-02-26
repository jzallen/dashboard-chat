## Context

The `token-refresh-flow` change established the baseline auth infrastructure: proactive timer, 401 interceptor, refresh endpoint, activity modal. A subsequent security review (`docs/backlog/workos-auth-hardening.md`) identified seven gaps across backend, frontend, and worker.

**Current state after review:**

| Area | Current State | Gap |
|------|--------------|-----|
| JWT verification | `audience=self.client_id`, `issuer="https://api.workos.com"` in `jwt.decode()` | ✅ Closed |
| Authorize URL | `scope`, `nonce`, `state` included; `redirect_uri` in code exchange | Frontend callback ignores `state` — no CSRF verification |
| Logout | Backend POSTs to `sessions/revoke`; frontend fire-and-forget to `/api/auth/logout` | ✅ Closed |
| Refresh retry timing | 12s delay in `ensureFreshToken`; proactive timer skips dev mode | ✅ Closed |
| Chat SSE 401 | Calls `hardLogout()` on final 401 failure | Diverges from token-refresh-flow spec (spec said no redirect) |
| logTurn 401 | Uses `withAuthRetry()` | ✅ Closed |
| Worker JWT | Local `jose` verification against WorkOS JWKS | ✅ Closed |
| Token storage | localStorage for access + refresh tokens | P3: migrate refresh token to httpOnly cookie |
| PKCE | Not implemented | Not in scope (follow-up) |
| State verification | Backend generates state; frontend discards it | In scope — requires frontend callback change |

**Implementation drift from token-refresh-flow spec:**

| Spec Said | Implementation Does | Resolution |
|-----------|-------------------|------------|
| Inactivity threshold: 60 minutes | 20 minutes | Tighter is more secure — update spec |
| Modal timeout: 5 minutes | 10 minutes | Longer grace period — update spec |
| Proactive refresh failure: 1 retry then logout | 3 retries (30s, 60s backoff), no logout | More resilient — update spec |
| Stream 401 retry failure: no redirect | Calls `hardLogout()` | Hardened — update spec |
| Refresh retry delay: 5 seconds | 12 seconds | Rate-limiter aligned — update spec |

These drifts are all in a more-secure or more-resilient direction and should be ratified in the modified specs.

**Constraints:**
- No Redis for auth (same as token-refresh-flow D3)
- No database schema changes (stateless JWT)
- WorkOS User Management API surface — no migration to Connect/OAuth2 in this change
- Must work in dev mode with same code paths (except proactive refresh which is now skipped)

## Goals / Non-Goals

**Goals:**
- Ratify implementation-spec drift from `token-refresh-flow` into updated specs
- Add CSRF state verification to the OAuth callback flow (frontend)
- Define security properties for JWT verification, session revocation, and authorize URL parameters
- Specify worker-local JWT verification to eliminate backend round-trip
- Document the secure-token-storage (httpOnly cookie) design for future implementation

**Non-Goals:**
- Connect/OAuth2 migration (legacy User Management endpoints remain for this change)
- PKCE support (`code_challenge`/`code_challenge_method`) — follow-up change
- httpOnly cookie implementation (design only — implementation is P3)
- Mid-stream 401 recovery (remains a known v1 limitation)
- Worker-side refresh flow (worker validates tokens only, doesn't refresh)
- Multi-instance rate limiting (in-memory remains sufficient)

## Decisions

### D10: Issuer URL for JWT verification

**Decision**: Use `issuer="https://api.workos.com"` for both backend (`PyJWT`) and worker (`jose`).

**Rationale**: WorkOS User Management access tokens set `iss: "https://api.workos.com"`. This is the legacy issuer; Connect/OAuth2 tokens use `https://authkit.app`. Since we remain on the User Management surface, the issuer matches. If we migrate to Connect/OAuth2 in a future change, the issuer will need updating in both locations.

**Alternative considered**: Configurable issuer via env var. Rejected — adds indirection for a value that's tightly coupled to the API surface we're using. A surface migration changes more than just the issuer.

### D11: Audience = client_id for JWT verification

**Decision**: Both backend and worker verify `aud` matches `WORKOS_CLIENT_ID`.

**Rationale**: WorkOS User Management access tokens always include `aud: <client_id>`. Verifying audience prevents tokens issued for a different WorkOS application from being accepted. PyJWT and jose both support this natively — no custom logic needed.

### D12: State parameter for CSRF protection on OAuth callback

**Decision**: Backend generates a `state` token (32 bytes, URL-safe) during login URL construction and returns it alongside the URL. Frontend stores it in `sessionStorage` and verifies it matches the `state` query param on callback.

**Implementation**:
1. `get_login_url()` returns `tuple[str, str]` (url, state)
2. Login route returns `{ "url": "...", "state": "..." }`
3. Frontend stores `state` in `sessionStorage` (not localStorage — scoped to tab, auto-cleared)
4. `AuthCallback` component reads `state` from URL params, compares to `sessionStorage`
5. On mismatch: redirect to `/login` (do not exchange code)

**Rationale**: CSRF protection via `state` is an OAuth 2.0 requirement (RFC 6749 §10.12). Without it, an attacker could initiate an OAuth flow in a victim's browser with the attacker's code. `sessionStorage` is appropriate because the state is tab-scoped and ephemeral.

**Alternative considered**: Server-side state storage (DB or memory). Rejected — adds server state for a value that only needs to survive a single redirect. `sessionStorage` is simpler and survives page navigation within the same tab.

### D13: Nonce for replay protection

**Decision**: Backend generates a `nonce` (32 bytes, URL-safe) and includes it in the authorize URL. No server-side nonce verification for now — WorkOS validates the nonce internally.

**Rationale**: Including `nonce` prevents token replay attacks. WorkOS embeds the nonce in the ID token; verifying it requires ID token inspection which is a future enhancement. Including it now ensures WorkOS-side protection is active.

### D14: Worker-local JWT verification via JWKS

**Decision**: Worker uses `jose.jwtVerify()` with `createRemoteJWKSet()` pointing at WorkOS JWKS endpoint. JWKS is lazily initialized and cached in memory. `jose` handles key rotation automatically.

**Implementation**:
```typescript
const jwks = createRemoteJWKSet(
  new URL(`https://api.workos.com/sso/jwks/${WORKOS_CLIENT_ID}`)
);
await jwtVerify(token, jwks, {
  audience: WORKOS_CLIENT_ID,
  issuer: "https://api.workos.com",
  algorithms: ["RS256"],
});
```

**Rationale**: Eliminates a network round-trip to `GET /api/auth/me` on every worker request. JWKS is cached by `jose` with automatic refresh on key rotation. The verification parameters (audience, issuer, algorithm) match the backend exactly.

**Alternative considered**: Keep `/api/auth/me` proxy. Rejected — adds ~50-200ms latency to every SSE message, session create, and turn log. The worker only needs to verify the token is valid, not resolve the full user object.

**Fallback**: If `WORKOS_CLIENT_ID` is not configured, return 401. If JWKS fetch fails, return 401. No silent pass-through.

### D15: Session revocation on logout (best-effort)

**Decision**: Backend `POST /api/auth/logout` extracts the Bearer token and POSTs to `https://api.workos.com/user_management/sessions/revoke` with 5s timeout. Revocation failure is logged but does not block logout. Frontend calls the endpoint fire-and-forget before clearing localStorage.

**Rationale**: Server-side revocation prevents the "logout then press back" re-authentication attack. Best-effort is appropriate because: (a) the local token clear is the primary logout mechanism, (b) network failures shouldn't prevent users from logging out, (c) WorkOS sessions have their own TTL.

**Alternative considered**: Blocking revocation (frontend waits for backend response). Rejected — logout should feel instant. A 5s WorkOS API timeout should never block the user.

### D16: Refresh retry timing aligned with rate limiter

**Decision**: `ensureFreshToken()` uses a flat 12s retry delay for all failure types (both 429 and non-429). The backend rate limiter window remains 10s.

**Rationale**: The original 5s non-429 delay was shorter than the 10s rate limiter window, guaranteeing a 429 on retry. 12s provides a 2s buffer. Using the same delay for all failure types is simpler and eliminates a class of timing bugs.

**Alternative considered**: Reduce rate limiter window to 3s. Rejected — the rate limiter exists to prevent refresh abuse. A 3s window is too permissive.

### D17: Skip proactive refresh in dev mode

**Decision**: The proactive refresh timer `useEffect` returns early when `VITE_AUTH_MODE === "dev"`. Dev tokens never expire server-side, so refresh calls are pure noise.

**Rationale**: Eliminates 401/429 log spam in dev mode. The 401 interceptor still works in dev mode (if someone manually invalidates the token), so the safety net remains.

### D18: Proactive refresh retry escalation (divergence from v1 spec)

**Decision**: Proactive refresh failures retry up to 3 times with escalating delays (30s, 60s) before giving up silently. The user is NOT force-logged-out on proactive refresh failure.

**Rationale**: Proactive refresh is an optimization, not a hard requirement. If all 3 retries fail, the token will eventually expire and the 401 interceptor will take over (which does force logout). Force-logging-out on proactive failure would be disruptive during transient network issues.

**Divergence**: The token-refresh-flow spec said "retry once, then logout." The implementation is more resilient. The spec should be updated to match.

### D19: Chat SSE 401 calls hardLogout (divergence from v1 spec)

**Decision**: When the SSE stream 401 retry fails, `hardLogout()` is called (clears localStorage, redirects to `/login`).

**Rationale**: Leaving the user "authenticated" in the UI with a broken chat is worse than redirecting to login. The v1 spec said "do not redirect" to avoid disrupting the user, but a failed-then-retried 401 means the session is genuinely invalid. The 401 interceptor for regular API calls already does hardLogout — SSE should be consistent.

**Divergence**: The chat-stream-resilience spec said "SHALL NOT be redirected to login." The implementation prioritizes consistency with the API interceptor. The spec should be updated.

### D20: httpOnly cookie for refresh token (P3 — design only)

**Decision (future)**: Migrate the refresh token from localStorage to an `httpOnly; Secure; SameSite=Lax` cookie set by the backend. The access token remains in JavaScript memory (not localStorage) with a short TTL.

**Architecture sketch**:
1. `POST /api/auth/callback` sets a `Set-Cookie: wos_refresh=<token>; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/refresh` response header instead of returning `refresh_token` in the JSON body
2. `POST /api/auth/refresh` reads the refresh token from the cookie (not request body)
3. Frontend no longer stores or sends refresh tokens — the browser handles cookie attachment automatically
4. `POST /api/auth/logout` clears the cookie via `Set-Cookie: wos_refresh=; Max-Age=0`
5. CORS must be configured with `credentials: include` and an explicit origin (not `*`)

**This is a BREAKING change** — the refresh endpoint contract changes from body-based to cookie-based. Requires coordinated frontend/backend deployment.

**Not implemented in this change** — documented here for the future P3 task.

## Risks / Trade-offs

### [Risk] State verification bypass on callback
**Scenario**: If the frontend `AuthCallback` component doesn't verify `state`, the CSRF protection from D12 is incomplete — the backend generates it but nobody checks it.
**Mitigation**: This change adds state verification to `AuthCallback`. If `state` doesn't match `sessionStorage`, redirect to `/login`.

### [Risk] JWKS endpoint availability for worker
**Scenario**: If `https://api.workos.com/sso/jwks/{client_id}` is down, the worker rejects all requests.
**Mitigation**: `jose` caches JWKS keys in memory. After initial fetch, the worker continues operating with cached keys until they expire. A full JWKS outage during a cold start would require backend fallback — accepted risk for v1.

### [Risk] Proactive refresh silent failure leaves stale token
**Scenario**: All 3 proactive retry attempts fail. The token expires. The user's next action triggers a 401.
**Mitigation**: The 401 interceptor handles this case — it refreshes and replays. The user experiences a brief delay on the next action but is not logged out unless the refresh token itself is invalid.

### [Risk] Session revocation race with refresh
**Scenario**: User clicks logout. Frontend fires revocation request, then clears tokens. Meanwhile, a proactive refresh timer fires and gets a new token from WorkOS before revocation completes.
**Mitigation**: The `logout()` function clears state synchronously after firing the revocation. The refresh timer's `useEffect` cleanup runs on state change, cancelling the timer. The race window is negligible.

### [Trade-off] Legacy JWKS endpoint
**Decision**: Both backend and worker use `https://api.workos.com/sso/jwks/{client_id}` (SSO endpoint). This is the legacy surface — Connect/OAuth2 provides a different JWKS URI.
**Rationale**: The legacy endpoint works for User Management tokens. Migrating JWKS endpoints is coupled to the full Connect/OAuth2 migration (P2), which is out of scope.

### [Trade-off] No PKCE
**Decision**: The authorize flow uses `code` + `state` but not PKCE (`code_challenge`/`code_challenge_method`).
**Rationale**: PKCE protects against authorization code interception. Since the code exchange happens server-to-server (backend to WorkOS) with a `client_secret`, the code alone is insufficient for an attacker. PKCE is a defense-in-depth measure — deferred to a follow-up change.

## Migration Plan

### What's Already Implemented

The following changes are already in the codebase on `v2-dev` and need only spec ratification:
- JWT audience + issuer verification (backend + worker)
- Authorize URL with scope, nonce, state (backend)
- redirect_uri in code exchange (backend)
- Session revocation on logout (backend + frontend)
- Refresh retry timing 12s (frontend)
- Dev mode refresh skip (frontend)
- Chat SSE hardLogout on 401 (frontend)
- logTurn withAuthRetry (frontend)
- Worker local JWT via jose (worker)

### What Still Needs Implementation

1. **Frontend state verification on callback** — `AuthCallback` component must read `state` from URL params, compare to `sessionStorage`, reject on mismatch
2. **Frontend login flow state storage** — `login()` function must store the `state` returned from `/api/auth/login` into `sessionStorage`

### Deployment

No phased deployment needed — all changes are backward-compatible except:
- Login response now includes `state` (additive, non-breaking)
- `get_login_url()` returns `tuple[str, str]` (already done, provider protocol updated)

### Rollback

- All changes are independently revertible
- Removing state verification is safe (weakens CSRF protection but doesn't break functionality)
- Worker can fall back to `/api/auth/me` proxy by reverting `auth.ts`

## Open Questions

### Q1: Should proactive refresh failure eventually force logout?
**Current**: Gives up silently after 3 retries. User stays "authenticated" until next API call triggers 401.
**Alternative**: After N failed proactive retries, show a "Session may have expired" banner (not force logout).
**Resolution**: Deferred — current behavior is acceptable. The 401 interceptor is the authoritative logout trigger.

### Q2: Connect/OAuth2 migration timeline
The legacy User Management endpoints work but are not the recommended surface. Migration to Connect/OAuth2 (`authkit.app/oauth2/*`) would change: authorize URL, token endpoint, JWKS URI, grant types, and issuer claim.
**Resolution**: Separate change. Tracked in backlog as P2.
