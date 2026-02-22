## Why

The application's auth token refresh mechanism and user activity detection are tightly coupled, causing users to be logged out every 5 minutes -- the exact WorkOS access token TTL. When the proactive refresh timer fires and the refresh call fails for any transient reason (network blip, WorkOS latency, 429 rate limit), the code immediately calls `logout()` even though the access token may still have ~1 minute of validity remaining. Meanwhile, the inactivity detection uses a fixed 60-minute timer (mismatched with the desired 20-minute inactivity + 10-minute modal = 30-minute session policy). These two independent concerns -- "keep the auth token alive" and "detect user absence" -- must be separated so that neither can trigger premature logout through the other's failure mode.

## What Changes

- **Decouple refresh timer from logout**: The proactive refresh timer (80% TTL) will no longer call `logout()` on failure. Instead, it will retry at 30s and 60s intervals. Only the 401 interceptor and the activity layer can trigger logout.
- **Fix stale token capture**: Pass the refresh token as a parameter to `doRefresh()` on the first attempt instead of re-reading from localStorage (where a consumed single-use WorkOS token may already be stale).
- **Add 429 rate-limit handling**: Detect 429 responses from the refresh endpoint and back off for 12 seconds before retrying (clearing the 10s backend rate-limit window).
- **Extend coalescing window**: Delay clearing `refreshPromise` by 500ms after settlement to prevent a narrow race where a concurrent caller starts a new refresh with a stale token.
- **Add diagnostic logging**: Insert `console.debug` and `console.warn` calls throughout the refresh path so failures are no longer invisible in the browser console.
- **Switch to debounced activity timestamps**: Replace the in-memory `lastActivityRef` with a `localStorage['last_activity_ts']` key, written on mousedown/keydown/scroll/touchstart but debounced to at most one write per 5 minutes. Check every 60s: if inactive for 20 minutes, show the modal.
- **Cross-tab activity sync**: Other tabs read `last_activity_ts` via the `StorageEvent` listener, so activity in any tab prevents the modal from appearing in all tabs.
- **Update modal timeout**: Change the ActivityCheckModal auto-logout timeout from 5 minutes to 10 minutes.
- **Add freshness guard**: Skip redundant refresh attempts if the current token still has >60s of validity remaining.

## Capabilities

### New Capabilities
- `activity-detection`: Debounced activity timestamp system using localStorage with cross-tab sync via StorageEvent. Replaces the in-memory fixed timer approach with a 20-minute inactivity threshold that triggers the "Are you still there?" modal.

### Modified Capabilities
(No existing specs to modify -- this is a greenfield OpenSpec setup.)

## Impact

- **Frontend only** -- no backend or worker changes required. The backend refresh endpoint, WorkOS provider, and dev provider are all functioning correctly.
- **Files modified**:
  - `frontend/src/lib/api/fetchUtils.ts` -- Refresh logic: logging, stale token fix, 429 handling, coalescing window, freshness guard
  - `frontend/src/lib/auth/AuthContext.tsx` -- Decouple refresh timer from logout (retry instead), implement debounced `last_activity_ts` with cross-tab sync, change inactivity threshold from 60 min to 20 min
  - `frontend/src/lib/ui/components/ActivityCheckModal/index.tsx` -- Change `MODAL_TIMEOUT_MS` from 5 min to 10 min
  - `frontend/src/test/auth/refreshTimer.test.tsx` -- Update and add tests for retry-before-logout, freshness guard
  - `frontend/src/test/auth/tokenInterceptor.test.ts` -- Add tests for 429 handling, freshness guard
  - `frontend/src/lib/ui/components/ActivityCheckModal/ActivityCheckModal.test.tsx` -- Update timeout assertions from 5 min to 10 min
- **localStorage schema change**: New key `last_activity_ts` (numeric timestamp). Existing keys `auth_token`, `auth_refresh_token`, `auth_token_expires_at` are unchanged.
- **No API contract changes** -- the `POST /api/auth/refresh` endpoint and its request/response shape remain identical.
- **Optional (out-of-band)**: Recommend increasing the WorkOS access token duration to 10-15 minutes via the WorkOS dashboard as a defense-in-depth measure, independent of these code changes.
