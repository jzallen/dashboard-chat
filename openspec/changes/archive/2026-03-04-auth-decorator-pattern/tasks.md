## 1. Extract auth modules to `lib/auth/` (additive, zero breakage)

- [x] 1.1 Create `frontend/src/lib/auth/tokenStorage.ts` — extract `TOKEN_KEY`, `REFRESH_TOKEN_KEY`, `EXPIRES_AT_KEY`, `ACTIVITY_KEY`, `getAuthHeaders()`, `hardLogout()` from `lib/api/fetchUtils.ts`
- [x] 1.2 Create `frontend/src/lib/auth/tokenRefresh.ts` — extract `RefreshError` (internal), `_resetRefreshState()`, `ensureFreshToken()`, `withAuthRetry()`, `handleResponse()` from `lib/api/fetchUtils.ts`. Import `getAuthHeaders`, `hardLogout`, token keys from `./tokenStorage` and `API_BASE_URL` from `../api/config`
- [x] 1.3 Create `frontend/src/lib/auth/withAuth.ts` — implement `withAuth(fetchFn)` and `withPreAuth(fetchFn)` decorators per spec. `withAuth` injects headers + retries on 401. `withPreAuth` proactively refreshes if token expires within 60s, then falls back to 401 retry. Import from `./tokenStorage` and `./tokenRefresh`
- [x] 1.4 Update `frontend/src/lib/auth/index.ts` — add re-exports for `tokenStorage` symbols, `tokenRefresh` symbols (`ensureFreshToken`, `_resetRefreshState`), and `withAuth`/`withPreAuth`
- [x] 1.5 Convert `frontend/src/lib/api/fetchUtils.ts` to deprecated re-export shim — replace body with re-exports from `../auth/tokenStorage` and `../auth/tokenRefresh`. Mark `@deprecated`
- [x] 1.6 Verify: `npx tsc --noEmit` passes, `npx vitest run src/test/auth/` passes, `npx vitest run src/lib/api/__tests__/` passes

## 2. Backend API client uses decorator

- [x] 2.1 Refactor `frontend/src/lib/api/client.ts` — replace `import { getAuthHeaders, withAuthRetry } from "./fetchUtils"` with `import { withAuth } from "../auth/withAuth"`. Create `const authedFetch = withAuth(fetch)`. Simplify `handleResponse<T>` to take only `Response` (no `url`/`init`). Wrap all methods to use `authedFetch`, catch `Error("Session expired")` → `ApiError(401, "Session expired")`
- [x] 2.2 Refactor `frontend/src/lib/api/projects.ts` — in `exportDbtProject()`, replace manual `getAuthHeaders()` + `withAuthRetry()` with `authedFetch` from a module-level `withAuth(fetch)`. Remove `fetchUtils` import
- [x] 2.3 Verify: `npx vitest run src/test/auth/apiClientAuth.test.ts` passes, `npx vitest run src/lib/api/__tests__/exportDbtProject.test.ts` passes

## 3. Chat worker client

- [x] 3.1 Create `frontend/src/lib/api/chatClient.ts` — move types (`ToolResult`, `ChatTurnPayload`, `ChatTurn`, `ChatSession`) and functions (`createSession`, `logTurn`, `getSession`, `listSessions`) from `sessions.ts`. Refactor to use `withAuth(fetch)`. Add `fetchChatStream()` moved from `ChatContext/services/chatStream.ts`, using `withPreAuth(fetch)`. Import `CHAT_URL` from `./config`
- [x] 3.2 Convert `frontend/src/lib/api/sessions.ts` to deprecated re-export shim — re-export all types and functions from `./chatClient`. Mark `@deprecated`
- [x] 3.3 Verify: `npx vitest run src/test/api/sessions.test.ts` passes (tests should work via re-exports)

## 4. Consumer cleanup

- [x] 4.1 Update `frontend/src/lib/ui/context/ChatContext/services/chatStream.ts` — remove `fetchChatStream` function and `authRetry` imports. Keep only `readSSEStream()` and `SSEHandlers`. Remove `CHAT_URL` import
- [x] 4.2 Update `frontend/src/lib/ui/context/ChatContext/hooks/useChatEngine.tsx` — import `fetchChatStream` from `@/api/chatClient` instead of `../services/chatStream`. Keep `readSSEStream` import from `../services/chatStream`
- [x] 4.3 Delete `frontend/src/lib/ui/context/ChatContext/services/authRetry.ts` — logic absorbed into `withPreAuth`
- [x] 4.4 Update `frontend/src/lib/auth/AuthContext.tsx` — change `import { ACTIVITY_KEY, ensureFreshToken, EXPIRES_AT_KEY, REFRESH_TOKEN_KEY, TOKEN_KEY } from "../api/fetchUtils"` to split imports from `./tokenStorage` and `./tokenRefresh`
- [x] 4.5 Update `frontend/src/lib/ui/components/ActivityDebugBadge.tsx` — change `import { ACTIVITY_KEY } from "../../api/fetchUtils"` to `from "../../auth/tokenStorage"`
- [x] 4.6 Update `frontend/src/lib/ui/data/config.ts` — remove `CHAT_URL` re-export, keep `API_URL` re-export
- [x] 4.7 Verify: `npx tsc --noEmit` passes, `npx vitest run src/test/ui/context/ChatContext.test.tsx` passes, `npx vitest run src/test/ui/components/ChatContext.test.tsx` passes

## 5. Test import updates

- [x] 5.1 Update `frontend/src/test/auth/tokenInterceptor.test.ts` — change `import { _resetRefreshState, ensureFreshToken } from "../../lib/api/fetchUtils"` to `from "../../lib/auth/tokenRefresh"`
- [x] 5.2 Update `frontend/src/test/auth/refreshTimer.test.tsx` — change `import { _resetRefreshState } from "../../lib/api/fetchUtils"` to `from "../../lib/auth/tokenRefresh"`
- [x] 5.3 Review `frontend/src/test/api/sessions.test.ts` — verify mocks are compatible with `withAuth` decorator pattern. Adjust if needed (auth headers are now injected by decorator, not by individual functions)
- [x] 5.4 Verify: full test suite passes — `npx vitest run src/test/auth/` and `npx vitest run src/test/api/`

## 6. Final cleanup

- [x] 6.1 Delete `frontend/src/lib/api/fetchUtils.ts` — all consumers now import from `lib/auth/`
- [x] 6.2 Verify: `npx tsc --noEmit` passes, `npx vitest run` passes (full suite)
