## Why

Every frontend HTTP client manually calls `getAuthHeaders()` and `withAuthRetry()` to attach auth headers and handle 401 retries. This creates tight coupling between business logic and the auth layer — making it hard to later move auth to an API gateway (where apps no longer manage auth themselves). Additionally, all auth utilities (`tokenStorage`, `tokenRefresh`, `withAuthRetry`) live in `lib/api/fetchUtils.ts` instead of `lib/auth/`, and there's no dedicated client for the chat-worker service (requests are scattered across `lib/api/sessions.ts` and `ChatContext/services/chatStream.ts`).

## What Changes

- **Move auth utilities from `lib/api/fetchUtils.ts` to `lib/auth/`** — Split into `tokenStorage.ts` (keys, `getAuthHeaders`, `hardLogout`) and `tokenRefresh.ts` (`ensureFreshToken`, `withAuthRetry`, coalesced refresh). `fetchUtils.ts` becomes a deprecated re-export shim, then gets deleted.
- **Introduce `withAuth` / `withPreAuth` fetch decorators in `lib/auth/withAuth.ts`** — `withAuth(fetch)` returns an auth-aware fetch that injects headers and retries on 401. `withPreAuth(fetch)` proactively refreshes tokens before the request (for SSE streams that can't be replayed). This decouples auth from every individual API function.
- **Refactor `lib/api/client.ts` and `lib/api/projects.ts`** — Replace manual `getAuthHeaders()` + `withAuthRetry()` calls with `withAuth(fetch)` decorator.
- **Create `lib/api/chatClient.ts`** — Dedicated chat-worker API client consolidating session functions (from `sessions.ts`) and SSE streaming (from `ChatContext/services/chatStream.ts`). Uses the decorator pattern. `sessions.ts` becomes a deprecated re-export shim.
- **Delete `ChatContext/services/authRetry.ts`** — Its logic (`refreshAuthHeadersIfExpiring`, `retryOn401`) is absorbed into `withPreAuth`.
- **Update all consumers** — `AuthContext.tsx`, `ActivityDebugBadge.tsx`, test files — to import from `lib/auth/` instead of `lib/api/fetchUtils.ts`.

## Capabilities

### New Capabilities
- `auth-fetch-decorator`: The `withAuth` and `withPreAuth` higher-order functions that wrap `fetch` with auth header injection and 401 retry/refresh logic, providing a transport-level auth layer that can be composed or removed independently.
- `chat-worker-client`: A dedicated API client (`lib/api/chatClient.ts`) for all chat-worker communication (session CRUD + SSE streaming), mirroring how `lib/api/client.ts` serves the backend.

### Modified Capabilities
- `token-refresh`: The 401 interceptor requirement changes from "both client.ts and fetchUtils.ts use shared interceptor" to "all API clients use `withAuth` decorator which encapsulates the shared interceptor." The behavioral spec (coalescing, retry, hard logout) is unchanged — only the integration mechanism changes from direct function calls to a decorator pattern.

## Impact

- **Frontend only** — Backend and worker services are untouched
- **`lib/auth/`** — 3 new files (`tokenStorage.ts`, `tokenRefresh.ts`, `withAuth.ts`), updated barrel export
- **`lib/api/`** — `client.ts` and `projects.ts` refactored; new `chatClient.ts`; `fetchUtils.ts` and `sessions.ts` become shims then get deleted
- **`lib/ui/context/ChatContext/`** — `chatStream.ts` loses `fetchChatStream` (moved to `chatClient.ts`); `authRetry.ts` deleted; `useChatEngine.tsx` import updated
- **`lib/ui/components/`** — `ActivityDebugBadge.tsx` import path updated
- **Tests** — `tokenInterceptor.test.ts`, `refreshTimer.test.tsx`, `sessions.test.ts` import paths updated; no behavioral test changes
- **No breaking public API changes** — Re-export shims ensure all existing import paths resolve during migration
