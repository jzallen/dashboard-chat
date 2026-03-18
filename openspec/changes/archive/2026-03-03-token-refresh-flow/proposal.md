## Why

WorkOS access tokens have a short TTL (~5 minutes). The application currently discards the refresh token returned during auth callback and has no renewal mechanism. When a token expires mid-session, all API calls fail with 401, the frontend immediately clears localStorage and redirects to `/login`, and the user loses all in-progress work -- including file uploads, chat streaming sessions, and unsaved table mutations. This is the top friction point for authenticated users.

## What Changes

- **Backend auth protocol extended** with `refresh_access_token` method and updated `handle_callback` return type to include refresh token and expiry metadata
- **New `POST /api/auth/refresh` endpoint** that proxies refresh token exchange to WorkOS, with in-memory rate limiting (1 req/IP/10s)
- **WorkOS provider captures refresh token** from callback response (currently discarded) and implements token refresh via WorkOS refresh grant
- **Dev provider simulates refresh** with incrementing token counters and simulated 5-minute TTL, exercising the same code paths as production
- **Frontend AuthProvider gains a proactive refresh timer** that fires at 80% of token TTL, silently renewing tokens before expiry
- **Frontend 401 interceptor** replaces hard-logout with coalesced refresh + request replay across `client.ts` and `fetchUtils.ts`
- **New ActivityCheckModal component** prompts "Are you still there?" after 60 minutes of inactivity, with 5-minute timeout before forced logout
- **Chat stream resilience** via pre-stream token freshness check (refresh if <60s remaining)
- **Callback response shape updated** to include `refresh_token` and `expires_in` fields

## Capabilities

### New Capabilities
- `token-refresh`: Proactive background token refresh (timer at 80% TTL), reactive 401 recovery with coalesced refresh and request replay, backend refresh endpoint proxying to WorkOS, dev mode refresh simulation
- `activity-check`: Inactivity detection after 60 minutes with confirmation modal, 5-minute dismissal timeout, forced logout on no response, keyboard-accessible modal with ARIA attributes
- `chat-stream-resilience`: Pre-stream token freshness validation, proactive refresh before SSE connection when token is near expiry, single retry on 401 during stream setup

### Modified Capabilities
<!-- No existing specs in openspec/specs/ to modify -->

## Impact

**Backend (5 files modified):**
- `backend/app/auth/provider.py` -- Protocol gains `refresh_access_token` method; `handle_callback` return type changes from `tuple[AuthUser, str]` to `tuple[AuthUser, str, str, int]` (**BREAKING** for any custom AuthProvider implementations)
- `backend/app/auth/workos_provider.py` -- Captures refresh_token, implements refresh method
- `backend/app/auth/dev_provider.py` -- Implements simulated refresh with incrementing tokens
- `backend/app/auth/middleware.py` -- `/api/auth/refresh` added to PUBLIC_PATHS
- `backend/app/routers/auth.py` -- New refresh endpoint, callback response shape extended

**Frontend (5 files modified, 1 new):**
- `frontend/src/lib/auth/types.ts` -- AuthState type extended with `refreshToken`, `tokenExpiresAt`
- `frontend/src/lib/auth/AuthContext.tsx` -- Refresh timer, token storage, activity tracking
- `frontend/src/lib/api/client.ts` -- 401 handler replaced with refresh-aware interceptor
- `frontend/src/lib/api/fetchUtils.ts` -- 401 handler replaced, new token constants
- `frontend/src/lib/ui/context/ChatContext.tsx` -- Pre-stream token check
- `frontend/src/lib/ui/components/ActivityCheckModal.tsx` -- NEW file

**Worker:** No changes for v1. Worker validates tokens via backend `/api/auth/me`.

**Database:** No migrations needed. Auth remains stateless JWT-based.

**Dependencies:** No new runtime dependencies. In-memory rate limiter (no Redis for auth). WorkOS SDK already present.

**API contract:** Callback response gains two new fields (`refresh_token`, `expires_in`). Existing fields unchanged. Non-breaking for consumers that ignore unknown fields.
