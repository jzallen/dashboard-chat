## Context

The application uses WorkOS for authentication with 5-minute access tokens. A proactive refresh timer fires at 80% TTL (~4 minutes) to silently renew the token. An activity check modal prompts idle users and eventually forces logout.

Currently, these two concerns are coupled: the refresh timer calls `logout()` directly on any refresh failure. Since WorkOS tokens have a short TTL and transient failures (network blips, 429 rate limits, WorkOS latency) are common, users experience premature logouts every 5 minutes even when actively working.

The existing implementation has several specific bugs:
1. **Immediate logout on refresh failure** -- `AuthContext.tsx` line 117 calls `logoutRef.current()` when `ensureFreshToken()` returns null, despite the token potentially having ~60s of validity remaining.
2. **Stale token capture** -- `doRefresh()` re-reads the refresh token from localStorage on every call. If the first attempt consumed the single-use token at WorkOS but the response failed to parse, the retry sends the same consumed token.
3. **Silent failures** -- `ensureFreshToken()` catches all errors and returns null with zero diagnostic logging.
4. **Wrong inactivity thresholds** -- 60-minute fixed timer instead of 20-minute inactivity detection; 5-minute modal timeout instead of 10 minutes.

### Current Architecture (single coupled layer)

```
┌─────────────────────────────────────────────┐
│               AuthContext.tsx                │
│                                             │
│  Refresh Timer ──fails──> logout()          │
│  Inactivity Timer ──fires──> modal ──> logout()  │
│  401 Interceptor ──fails──> hardLogout()    │
│                                             │
│  Problem: 3 paths to logout, refresh        │
│  timer shouldn't be one of them             │
└─────────────────────────────────────────────┘
```

## Goals / Non-Goals

**Goals:**
- Eliminate premature logouts caused by transient refresh failures
- Separate auth token lifecycle (refresh) from user presence detection (activity) into independent layers
- Implement debounced activity timestamps in localStorage for cross-tab coordination
- Change session policy to 20-min inactivity + 10-min modal (30-min total from last activity)
- Add diagnostic logging for all refresh operations so failures are visible in the browser console
- Fix the stale token bug in `doRefresh()` that breaks single-use WorkOS refresh token rotation
- Handle 429 rate-limit responses with appropriate backoff

**Non-Goals:**
- Backend changes (the refresh endpoint, WorkOS provider, and dev provider are functioning correctly)
- Multi-tab token refresh coordination via BroadcastChannel (StorageEvent on `last_activity_ts` is sufficient)
- Sliding session extension based on API call activity (inactivity is measured by UI interaction events only)
- Server-side session management or refresh token revocation
- Offline/PWA token caching
- Changes to the WorkOS dashboard token TTL (recommended as out-of-band defense-in-depth, not a code change)

## Decisions

### Decision 1: Two-Layer Architecture (Auth Refresh vs Activity Detection)

**Choice**: Separate the refresh timer and activity detection into fully independent subsystems where only the activity layer and the 401 interceptor can trigger logout.

**Rationale**: The refresh timer's job is to keep the token alive. If it fails, the user's existing token may still be valid for up to 60 seconds. Logging the user out because a background refresh failed -- when they might be mid-upload or mid-chat -- is a poor user experience. The token's actual validity is proven by API calls: if a real request gets a 401, the interceptor handles it. The activity layer separately tracks whether the user is present.

**Architecture**:

```
┌─────────────────────────────────────────────────────────┐
│                    AuthContext.tsx                        │
│                                                          │
│  ┌──────────────────┐    ┌────────────────────────────┐  │
│  │  Refresh Layer   │    │    Activity Layer           │  │
│  │                  │    │                             │  │
│  │  Timer (80% TTL) │    │  Debounced writes to        │  │
│  │  ↓               │    │  localStorage[last_activity] │  │
│  │  ensureFreshToken │    │  ↓                          │  │
│  │  ↓               │    │  60s interval check          │  │
│  │  fail? retry 30s │    │  ↓                          │  │
│  │  fail? retry 60s │    │  inactive 20min? → modal     │  │
│  │  fail? stop      │    │  modal 10min? → logout()     │  │
│  │  (NEVER logout)  │    │                             │  │
│  └──────────────────┘    └────────────────────────────┘  │
│                                                          │
│  ┌──────────────────┐                                    │
│  │  401 Interceptor │  (in fetchUtils.ts)                │
│  │  401 → refresh → replay                              │
│  │  fail? → hardLogout()                                │
│  └──────────────────┘                                    │
└─────────────────────────────────────────────────────────┘
```

**Alternatives considered**:
- *Keep coupled, just add retries*: Simpler, but fundamentally wrong -- the refresh timer should not be in the business of deciding whether the user's session is valid.
- *Use a state machine for auth lifecycle*: More formal, but overkill for the actual problem. The two layers need no coordination except that both call the same `logout()` function.

### Decision 2: localStorage-based Activity Timestamps with Debounced Writes

**Choice**: Store `Date.now()` in `localStorage['last_activity_ts']` on user interaction events, debounced to at most one write per 5 minutes.

**Rationale**: localStorage provides free cross-tab sync via the `StorageEvent` API. A 5-minute debounce prevents excessive I/O (at ~4 mousedowns/second during active use, that's 240 writes/minute avoided). The 20-minute inactivity threshold is 4x the debounce window, so the worst case staleness (5 min) still leaves a 15-minute buffer before false-positive inactivity detection.

**localStorage schema**:

| Key | Type | Set By | Read By |
|-----|------|--------|---------|
| `auth_token` | string | login, callback, refresh | API client, refresh timer |
| `auth_refresh_token` | string | callback, refresh | refresh logic |
| `auth_token_expires_at` | string (numeric) | callback, refresh | refresh timer, freshness guard |
| `last_activity_ts` | string (numeric) | activity tracker (debounced) | inactivity checker (60s interval) |

**Debounce mechanism** (pseudocode):
```typescript
const ACTIVITY_DEBOUNCE_MS = 5 * 60 * 1000; // 5 minutes
const ACTIVITY_KEY = "last_activity_ts";

const updateActivity = () => {
  const now = Date.now();
  const last = Number(localStorage.getItem(ACTIVITY_KEY) || "0");
  if (now - last > ACTIVITY_DEBOUNCE_MS) {
    localStorage.setItem(ACTIVITY_KEY, String(now));
  }
};
```

**Alternatives considered**:
- *In-memory ref only (current approach)*: No cross-tab sync, resets on page refresh, couples to React lifecycle.
- *BroadcastChannel API*: More explicit, but requires managing channel lifecycle. StorageEvent is simpler and sufficient since we already use localStorage.
- *Cookie-based timestamp*: Server-visible but adds unnecessary network overhead on every request.

### Decision 3: Retry Strategy for Proactive Refresh Timer

**Choice**: On refresh failure, retry at 30 seconds, then at 60 seconds. After 3 total failures, stop retrying (but do NOT logout).

**Rationale**: The token has ~60s of remaining validity when the proactive timer fires (80% of 5-min TTL = 4 min, leaving 1 min). A 30s retry gives the first retry a chance while the token is still likely valid. A 60s retry is a last-ditch effort. If all fail, the token may be expired, but the next real API call's 401 will be caught by the interceptor, which can attempt its own refresh. This avoids duplicate logout paths.

**Alternatives considered**:
- *Immediate retry*: Could hit the same transient issue.
- *Exponential backoff*: Unnecessary complexity for 2-3 retries over ~90 seconds.
- *Logout after retries exhausted*: Defeats the purpose of decoupling. The 401 interceptor already handles expired tokens.

### Decision 4: Stale Token Fix via Parameter Passing

**Choice**: Pass the refresh token as a function parameter to `doRefresh()` on the first attempt. On retry, re-read from localStorage.

**Rationale**: WorkOS refresh tokens are single-use. If the first attempt sends the token and WorkOS consumes it, but the response fails (network timeout, parse error), the token in localStorage is now stale. Re-reading it for retry would send the same consumed token. By capturing it at entry and passing it, the first attempt uses the known-good token. For the retry, we re-read from localStorage because another tab may have successfully refreshed in the meantime, writing a new valid token.

**Alternatives considered**:
- *Always re-read from localStorage*: Current behavior, causes the bug.
- *Always use captured token*: Misses cross-tab refresh that may have written a new token.
- *Lock mechanism*: Overkill; the coalescing promise already prevents concurrent refreshes within the same tab.

### Decision 5: 429 Handling with 12-Second Backoff

**Choice**: On 429 response from the refresh endpoint, wait 12 seconds before retrying (vs 5 seconds for other errors).

**Rationale**: The backend rate limiter uses a 10-second window per IP. Waiting 12 seconds guarantees the window has fully expired. This is a targeted fix: only 429s use the longer delay; other errors still retry at 5 seconds.

### Decision 6: Extended Coalescing Window (500ms)

**Choice**: Delay clearing `refreshPromise = null` by 500ms after the refresh promise settles.

**Rationale**: There is a narrow race window between when the promise resolves and when the calling code reads the new token from localStorage. If another caller invokes `ensureFreshToken()` in this window, it would start a brand new refresh with a stale token (the one from before the first refresh). A 500ms delay ensures latecomers join the existing promise result.

## Risks / Trade-offs

**[Risk] Stale activity timestamp causes delayed modal** -- If a user goes inactive immediately after a debounced write, the timestamp could be up to 5 minutes stale, meaning the modal appears 5 minutes late (at 25 min instead of 20 min).
- *Mitigation*: Acceptable trade-off. The 5-minute staleness is bounded and the security impact is minimal (25 min vs 20 min). The debounce is necessary to prevent localStorage write storms.

**[Risk] Cross-tab logout race** -- Multiple tabs detecting inactivity simultaneously could trigger multiple logout calls.
- *Mitigation*: `logout()` is idempotent (clears localStorage and sets state). Multiple calls have no adverse effect. The StorageEvent propagation means tabs will quickly converge.

**[Risk] Refresh timer stops after 3 failures but user continues working** -- If all 3 refresh attempts fail and the user is still active, their token is expired. The next API call will 401.
- *Mitigation*: This is by design. The 401 interceptor handles this case with its own refresh + replay logic. The user experiences at most a brief delay, not a logout (unless the interceptor's refresh also fails, which indicates a genuine auth problem).

**[Risk] localStorage unavailable (private browsing, storage quota)** -- Some browsers restrict localStorage in private mode.
- *Mitigation*: The current app already depends on localStorage for auth tokens. The activity timestamp adds one more key but doesn't change the dependency. If localStorage is unavailable, auth already doesn't work.

**[Risk] 500ms coalescing window causes stale responses** -- A caller might get a slightly old token if the promise resolved 499ms ago and a new refresh was needed.
- *Mitigation*: The freshness guard (>60s check) prevents unnecessary refreshes. The 500ms window is small enough that the token will still have substantial validity remaining.

## Open Questions

- **WorkOS dashboard TTL increase**: Should the team increase the WorkOS access token duration to 10-15 minutes via the WorkOS dashboard? This is a defense-in-depth measure that reduces refresh frequency and the window for transient failures. It is independent of the code changes and can be done at any time.
