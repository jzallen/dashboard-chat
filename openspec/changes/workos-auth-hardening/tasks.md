## 1. Backend JWT & Authorize URL (verify existing)

- [x] 1.1 Verify `workos_provider.py` `verify_token()` passes `audience=self.client_id` and `issuer="https://api.workos.com"` to `jwt.decode()` — no manual audience check after decode
- [x] 1.2 Verify `get_login_url()` includes `scope=openid profile email`, a random `nonce`, and a random `state` in the authorize URL
- [x] 1.3 Verify `get_login_url()` returns `tuple[str, str]` (url, state) and the login route returns `{ url, state }`
- [x] 1.4 Verify `handle_callback()` includes `redirect_uri` in the token exchange POST body
- [x] 1.5 Verify the `AuthProvider` protocol in `provider.py` and `DevAuthProvider` match the updated `get_login_url` signature

## 2. Frontend OAuth State Verification (implement)

- [x] 2.1 Update `AuthContext.login()` to store the `state` value from `/api/auth/login` response into `sessionStorage` under key `oauth_state`
- [x] 2.2 Update `AuthCallback` component to read `state` from URL query params and `oauth_state` from `sessionStorage`
- [x] 2.3 Add state comparison: reject callback (redirect to `/login`) if `state` is missing or doesn't match `sessionStorage`
- [x] 2.4 Remove `oauth_state` from `sessionStorage` after comparison (success or failure)
- [x] 2.5 Add tests for AuthCallback state verification: match, mismatch, missing state, missing sessionStorage

## 3. Backend Session Revocation (verify existing)

- [x] 3.1 Verify `workos_provider.py` has a `revoke_session()` method that POSTs to `https://api.workos.com/user_management/sessions/revoke` with 5s timeout
- [x] 3.2 Verify the `POST /api/auth/logout` route extracts the Bearer token and calls revocation
- [x] 3.3 Verify revocation is best-effort (failures logged, not raised)
- [x] 3.4 Verify dev provider's `get_logout_url()` returns `"/"` with no external calls

## 4. Frontend Auth Timing (verify existing)

- [x] 4.1 Verify `ensureFreshToken()` retry delay is 12s for all failure types (both 429 and non-429)
- [x] 4.2 Verify the proactive refresh timer `useEffect` returns early when `VITE_AUTH_MODE === "dev"`
- [x] 4.3 Verify `AuthContext.logout()` fires a `POST /api/auth/logout` with the Bearer token before clearing localStorage

## 5. Frontend 401 Consistency (verify existing)

- [x] 5.1 Verify `ChatContext.tsx` SSE 401 retry calls `hardLogout()` when the retried response is still 401
- [x] 5.2 Verify `sessions.ts` `logTurn()` passes response through `withAuthRetry()`
- [x] 5.3 Verify `hardLogout` and `withAuthRetry` are exported from `fetchUtils.ts`

## 6. Worker Local JWT Verification (verify existing)

- [x] 6.1 Verify `worker/lib/auth.ts` imports `createRemoteJWKSet` and `jwtVerify` from `jose`
- [x] 6.2 Verify production mode calls `jwtVerify` with `audience`, `issuer`, and `algorithms: ["RS256"]` — not `/api/auth/me`
- [x] 6.3 Verify JWKS is lazily initialized and cached
- [x] 6.4 Verify missing `WORKOS_CLIENT_ID` returns 401 in production mode
- [x] 6.5 Verify dev mode path is unchanged (string comparison against `DEV_TOKEN`)
- [x] 6.6 Verify `docker-compose.yml` includes `WORKOS_CLIENT_ID` in worker service environment

## 7. Tests

- [x] 7.1 Backend: run `cd backend && uv run pytest tests/ -k auth` — all pass (53 passed, 2 skipped)
- [x] 7.2 Frontend: run `cd frontend && npx vitest run` — all pass (258 passed, 26 test files)
- [x] 7.3 Worker: run `npm run test:worker` — all pass (7 passed)
- [x] 7.4 Add missing test: AuthCallback state verification (from task 2.5) — 5 new tests added
- [x] 7.5 Review test coverage gaps noted in research: no tests for `withAuthRetry()` directly, no tests for cross-tab sync, no tests for inactivity timeout — `withAuthRetry` is tested indirectly via tokenInterceptor.test.ts (7 tests); cross-tab sync and inactivity timeout are out of scope for this change
