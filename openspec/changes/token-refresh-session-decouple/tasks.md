## 1. Token Refresh Resilience (fetchUtils.ts)

- [ ] 1.1 Add diagnostic logging to `ensureFreshToken()` in `frontend/src/lib/api/fetchUtils.ts`. Insert `console.debug("[auth] Starting token refresh")` on entry, `console.warn("[auth] No refresh token available")` when returning null early, `console.warn("[auth] First refresh attempt failed:", err)` on first failure, `console.error("[auth] Token refresh failed after retry:", err)` on final failure, and `console.debug("[auth] Token refresh successful, expires_in:", data.expires_in)` on success. **Acceptance**: All five log statements present; running `console.debug` filter in browser shows `[auth]` messages during refresh.

- [ ] 1.2 Add freshness guard to `ensureFreshToken()` in `frontend/src/lib/api/fetchUtils.ts`. Before initiating a refresh, read `EXPIRES_AT_KEY` from localStorage and return the current token immediately if `expiresAt - Date.now() > 60_000`. **Acceptance**: Calling `ensureFreshToken()` when the token has >60s remaining returns the current token without making a fetch call.

- [ ] 1.3 Fix stale token capture in `doRefresh()` in `frontend/src/lib/api/fetchUtils.ts`. Change `doRefresh()` to accept a `refreshToken: string` parameter. On the first call, pass the token captured at `ensureFreshToken()` entry. On retry, re-read from `localStorage.getItem(REFRESH_TOKEN_KEY)`. **Acceptance**: First attempt uses the captured token; retry reads a fresh value from localStorage.

- [ ] 1.4 Add 429 rate-limit handling in `ensureFreshToken()` in `frontend/src/lib/api/fetchUtils.ts`. In the catch block, detect 429 response status and use a 12-second delay (instead of 5 seconds) before retrying. Non-429 failures continue using the 5-second delay. **Acceptance**: A mocked 429 response triggers a 12-second wait; a mocked 500 response triggers a 5-second wait.

- [ ] 1.5 Extend coalescing window in `ensureFreshToken()` in `frontend/src/lib/api/fetchUtils.ts`. Replace the immediate `refreshPromise = null` in `.finally()` with a 500ms delayed clear: `setTimeout(() => { refreshPromise = null; }, 500)`. **Acceptance**: A second caller within 500ms of promise settlement joins the existing promise rather than starting a new refresh.

## 2. Decouple Refresh Timer from Logout (AuthContext.tsx)

- [ ] 2.1 Modify the proactive refresh timer effect in `frontend/src/lib/auth/AuthContext.tsx`. When `ensureFreshToken()` returns null, schedule a 30-second retry instead of calling `logoutRef.current()`. If the 30s retry also fails, schedule a 60-second retry. After 3 total failures, stop retrying but do NOT call logout. Add a `useRef` for the retry timer and clean it up in the effect's teardown. Add `console.warn("[auth] Proactive refresh failed, scheduling retry...")` logging. **Acceptance**: A failing refresh does not trigger logout; the timer retries twice before giving up silently. The 401 interceptor remains the only code path to `hardLogout()` from the refresh layer.

- [ ] 2.2 Add a 10-second minimum delay floor to the proactive refresh timer in `frontend/src/lib/auth/AuthContext.tsx`. Ensure `Math.max(ttl * 0.8, 10_000)` so that a stale or near-zero `tokenExpiresAt` does not cause the timer to fire immediately upon mount. **Acceptance**: With a `tokenExpiresAt` in the past, the timer fires at 10 seconds, not 0.

## 3. Debounced Activity Timestamps (AuthContext.tsx)

- [ ] 3.1 Replace the in-memory `lastActivityRef` with debounced localStorage writes in `frontend/src/lib/auth/AuthContext.tsx`. Define constants `ACTIVITY_KEY = "last_activity_ts"` and `ACTIVITY_DEBOUNCE_MS = 5 * 60 * 1000`. Change the `updateActivity` handler to: read the current `last_activity_ts` from localStorage, compare with `Date.now()`, and only write if the difference exceeds `ACTIVITY_DEBOUNCE_MS`. Initialize `last_activity_ts` on mount if not already set. **Acceptance**: Rapid user interactions produce at most one localStorage write per 5 minutes. The `last_activity_ts` key is present in localStorage after the first interaction.

- [ ] 3.2 Change the inactivity check interval in `frontend/src/lib/auth/AuthContext.tsx`. Replace `inactiveMs >= 60 * 60 * 1000` with `inactiveMs >= 20 * 60 * 1000`. Extract as a named constant `INACTIVITY_THRESHOLD_MS = 20 * 60 * 1000`. Read the timestamp from `localStorage.getItem(ACTIVITY_KEY)` instead of from `lastActivityRef.current`. **Acceptance**: The ActivityCheckModal appears after 20 minutes of inactivity, not 60 minutes.

- [ ] 3.3 Update `handleActivityContinue` in `frontend/src/lib/auth/AuthContext.tsx` to write `Date.now()` to `localStorage['last_activity_ts']` in addition to dismissing the modal. **Acceptance**: Clicking "Continue" on the modal writes a fresh timestamp to localStorage.

## 4. Cross-Tab Sync (AuthContext.tsx)

- [ ] 4.1 Add a `StorageEvent` listener in `frontend/src/lib/auth/AuthContext.tsx`. Listen for changes to `EXPIRES_AT_KEY` (another tab refreshed the token) and update React state with the new token/expiry from localStorage. Listen for removal of `TOKEN_KEY` (another tab logged out) and clear auth state locally. Clean up the listener on unmount. **Acceptance**: Logging out in tab A clears auth state in tab B. A refresh in tab A updates the token state in tab B.

## 5. ActivityCheckModal Timeout Update

- [ ] 5.1 Change `MODAL_TIMEOUT_MS` in `frontend/src/lib/ui/components/ActivityCheckModal/index.tsx` from `5 * 60 * 1000` to `10 * 60 * 1000`. Update the comment from "5 minutes" to "10 minutes". **Acceptance**: The constant value is `600000` (10 minutes).

## 6. Update Refresh Timer Tests

- [ ] 6.1 Add test case "schedules a 30-second retry before logging out when proactive refresh fails" in `frontend/src/test/auth/refreshTimer.test.tsx`. Mock `ensureFreshToken()` to return null on first call, then a valid token on the 30s retry. Verify that after the initial timer fires, `logout` is NOT called, and after advancing 30 seconds, the retry succeeds and the token is updated. **Acceptance**: Test passes; no premature logout on first failure.

- [ ] 6.2 Update test "logs out after first attempt and retry both fail" in `frontend/src/test/auth/refreshTimer.test.tsx`. Change assertion to verify that after all 3 attempts (initial + 30s retry + 60s retry) fail, the user is still NOT logged out (because the refresh timer no longer triggers logout). **Acceptance**: Test verifies the user remains authenticated after refresh exhaustion.

- [ ] 6.3 Add test case "skips refresh if token is still fresh (freshness guard)" in `frontend/src/test/auth/refreshTimer.test.tsx`. Set `auth_token_expires_at` far in the future, invoke `ensureFreshToken()`, and verify no fetch call is made. **Acceptance**: Test passes; no network request when token has >60s validity.

## 7. Update Token Interceptor Tests

- [ ] 7.1 Add test case "skips refresh if token is still fresh" in `frontend/src/test/auth/tokenInterceptor.test.ts`. Set `auth_token_expires_at` to future, trigger `ensureFreshToken()`, verify no fetch. **Acceptance**: Test passes.

- [ ] 7.2 Add test case "handles 429 rate-limit with longer retry delay" in `frontend/src/test/auth/tokenInterceptor.test.ts`. Mock a 429 response on first refresh attempt, verify the retry happens after 12 seconds (not 5 seconds). **Acceptance**: Test passes; timer advances 12 seconds for retry.

## 8. Update ActivityCheckModal Tests

- [ ] 8.1 Update test "auto-logs out after 5 minutes with no interaction" in `frontend/src/lib/ui/components/ActivityCheckModal/ActivityCheckModal.test.tsx`. Change the timer advance to 10 minutes (10 * 60 * 1000). Update the "just under" assertion from 4:59 to 9:59 (9 * 60 * 1000 + 59 * 1000). Update test description to reference 10 minutes. **Acceptance**: Test passes with 10-minute timeout assertions.

- [ ] 8.2 Update the "clears timeout when modal closes" test comment in `frontend/src/lib/ui/components/ActivityCheckModal/ActivityCheckModal.test.tsx` to advance past 10 minutes instead of 5 minutes (change `6 * 60 * 1000` to `11 * 60 * 1000`). **Acceptance**: Test passes with updated timer value.

## 9. Cleanup of localStorage on Logout

- [ ] 9.1 Add `localStorage.removeItem("last_activity_ts")` to the `logout` function in `frontend/src/lib/auth/AuthContext.tsx` and to `hardLogout()` in `frontend/src/lib/api/fetchUtils.ts`. **Acceptance**: After logout, `localStorage.getItem("last_activity_ts")` returns null.

## 10. Verification

- [ ] 10.1 Run all modified test files: `cd /workspaces/dashboard-chat/frontend && npx vitest run src/test/auth/refreshTimer.test.tsx src/test/auth/tokenInterceptor.test.ts src/lib/ui/components/ActivityCheckModal/ActivityCheckModal.test.tsx`. **Acceptance**: All tests pass.

- [ ] 10.2 Run full frontend test suite: `cd /workspaces/dashboard-chat/frontend && npx vitest run`. **Acceptance**: No regressions; all tests pass.
