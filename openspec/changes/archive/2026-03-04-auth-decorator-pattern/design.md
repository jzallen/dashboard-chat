## Context

The frontend has three HTTP integration points:
1. **Backend API** (`lib/api/client.ts`) — JSON requests to FastAPI on port 8000
2. **Chat worker sessions** (`lib/api/sessions.ts`) — JSON requests to Hono worker on port 8787
3. **Chat worker SSE** (`ChatContext/services/chatStream.ts`) — Streaming requests to the worker

All three manually wire auth by calling `getAuthHeaders()` before each request and `withAuthRetry()` after each response. This auth logic lives in `lib/api/fetchUtils.ts` — a file that is 100% auth-focused but lives in the API package instead of `lib/auth/`.

The SSE streaming path has a separate auth implementation in `ChatContext/services/authRetry.ts` (`refreshAuthHeadersIfExpiring` + `retryOn401`) because SSE streams can't be replayed — they need proactive token refresh before the request.

There are 6 consumer files importing from `fetchUtils.ts`, 3 test files, and 1 UI component (`ActivityDebugBadge.tsx`).

## Goals / Non-Goals

**Goals:**
- Decouple auth from individual API functions via a decorator pattern on `fetch`
- Relocate all auth utilities from `lib/api/fetchUtils.ts` to `lib/auth/`
- Create a dedicated chat-worker API client (`lib/api/chatClient.ts`)
- Unify the two auth retry strategies (post-response retry + pre-request refresh) under two decorator variants
- Preserve all existing behavior (coalesced refresh, 401 retry, hard logout)
- Enable incremental migration with zero breakage at each step

**Non-Goals:**
- Moving auth to an API gateway (this change makes that *possible* later by decoupling, but doesn't implement it)
- Changing backend or worker auth middleware
- Modifying token storage strategy (stays in localStorage)
- Adding new auth features (MFA, session tokens, etc.)
- Changing the public React hook API (`useChatContext`, `useAuth`)

## Decisions

### 1. Decorator wraps `fetch`, not higher-level methods

**Decision**: `withAuth` and `withPreAuth` are higher-order functions that take a `fetch`-compatible function and return a `fetch`-compatible function.

```ts
type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
function withAuth(fetchFn: FetchFn): FetchFn
function withPreAuth(fetchFn: FetchFn): FetchFn
```

**Rationale**: Wrapping at the fetch level gives maximum composability. Any code that calls `fetch` can opt into auth with one line (`const authedFetch = withAuth(fetch)`). This is the standard middleware pattern used by libraries like `ky`, `wretch`, and Cloudflare's `fetch` event handler. It also makes the decorator trivially removable — replace `authedFetch` with `fetch` and auth disappears.

**Alternative considered**: Wrapping at the client method level (e.g., `withAuth(client.get)`). Rejected because it ties auth to a specific client API surface and doesn't help ad-hoc `fetch` calls (like `exportDbtProject` and SSE streaming).

### 2. Two decorator variants for different retry strategies

**Decision**: `withAuth` for standard JSON APIs, `withPreAuth` for SSE streams.

- `withAuth(fetch)`: Injects `Authorization` header from `getAuthHeaders()`, calls the inner fetch, and on 401 response triggers `ensureFreshToken()` + replay.
- `withPreAuth(fetch)`: Checks token expiry before the request (via `refreshAuthHeadersIfExpiring()`), injects fresh headers, calls the inner fetch. On 401, falls back to the same refresh+replay logic.

**Rationale**: SSE streams are long-lived and can't be transparently replayed. Pre-refreshing before the request is the existing pattern in `authRetry.ts` and is the correct strategy for streams. Standard JSON requests benefit from the simpler post-response pattern (don't refresh unless needed).

**Alternative considered**: Single decorator with a `{preRefresh: boolean}` option. Rejected for clarity — two named functions are self-documenting and prevent misconfiguration.

### 3. Auth files split into `tokenStorage.ts` and `tokenRefresh.ts`

**Decision**: Split `fetchUtils.ts` into two files by concern:
- `tokenStorage.ts`: Synchronous localStorage operations — `TOKEN_KEY`, `REFRESH_TOKEN_KEY`, `EXPIRES_AT_KEY`, `ACTIVITY_KEY`, `getAuthHeaders()`, `hardLogout()`
- `tokenRefresh.ts`: Async refresh logic — `RefreshError`, `ensureFreshToken()`, `withAuthRetry()`, `handleResponse()`, `_resetRefreshState()`

**Rationale**: `tokenStorage.ts` has zero async operations and zero external dependencies (just localStorage + window.location). `tokenRefresh.ts` does async HTTP calls and depends on `tokenStorage`. Splitting them makes the dependency graph clean: `withAuth.ts` → `tokenRefresh.ts` → `tokenStorage.ts`.

### 4. Deprecated re-export shims for incremental migration

**Decision**: `fetchUtils.ts` and `sessions.ts` become thin re-export shims marked `@deprecated` before being deleted in the final phase.

**Rationale**: This ensures zero breakage at any intermediate commit. All existing import paths continue to resolve. The shims are removed only after all consumers have been migrated. This supports shipping the change in multiple PRs if needed.

### 5. `chatClient.ts` consolidates all worker communication

**Decision**: New file `lib/api/chatClient.ts` owns:
- Session CRUD: `createSession`, `logTurn`, `getSession`, `listSessions` (moved from `sessions.ts`)
- SSE streaming: `fetchChatStream` (moved from `ChatContext/services/chatStream.ts`)
- All types: `ToolResult`, `ChatTurnPayload`, `ChatTurn`, `ChatSession`

Stream parsing (`readSSEStream`, `SSEHandlers`) stays in `ChatContext/services/chatStream.ts` — it's pure data transformation, not an API concern.

**Rationale**: Mirrors the pattern of `client.ts` (backend API) having its own file. Gives the chat worker a single point of entry. Uses `withAuth(fetch)` for session endpoints and `withPreAuth(fetch)` for SSE streaming.

### 6. `client.ts` handleResponse simplification

**Decision**: After switching to `withAuth`, the `handleResponse` function in `client.ts` no longer needs `url` and `init` params (the decorator handles retry). Its signature simplifies to `handleResponse<T>(response: Response): Promise<T>`. The "Session expired" error from the decorator gets caught and converted to `ApiError(401, "Session expired")` at the method level.

## Risks / Trade-offs

**[Mock coupling in tests]** → Tests that mock `global.fetch` will now see their mocked fetch wrapped by the decorator. The decorator calls `getAuthHeaders()` and potentially `ensureFreshToken()` on the mock. Existing test mocks for localStorage tokens should make this work transparently, but `sessions.test.ts` may need mock adjustments.

**[Two fetch instances]** → `client.ts` and `chatClient.ts` each create their own `const authedFetch = withAuth(fetch)`. This is intentional — they wrap the same global `fetch` and share the same coalesced `refreshPromise` in `tokenRefresh.ts`. No state duplication.

**[SSE pre-refresh timing]** → `withPreAuth` refreshes if token expires within 60 seconds. For very long SSE streams, the token could expire mid-stream. This is the existing behavior and is acceptable — the worker validates the token once at connection time, not continuously.

**[Re-export shim maintenance]** → During migration, `fetchUtils.ts` and `sessions.ts` are shims. If the change is implemented in a single PR, the shims exist only in intermediate commits, not in the final state.

## Migration Plan

**Phase 1 — Extract auth modules (additive)**
Create `tokenStorage.ts`, `tokenRefresh.ts`, `withAuth.ts` in `lib/auth/`. Convert `fetchUtils.ts` to re-export shim. All existing imports resolve. Run full test suite.

**Phase 2 — Backend client uses decorator**
Refactor `client.ts` and `projects.ts` to use `withAuth(fetch)`. Remove their `fetchUtils` imports. Run API and auth tests.

**Phase 3 — Chat worker client + consumer cleanup**
Create `chatClient.ts`. Convert `sessions.ts` to re-export shim. Update `ChatContext/services/chatStream.ts` (remove `fetchChatStream`), `useChatEngine.tsx` (update import), `AuthContext.tsx` and `ActivityDebugBadge.tsx` (import from `lib/auth/`). Delete `authRetry.ts`. Update test imports. Run full test suite.

**Phase 4 — Delete shims**
Delete `fetchUtils.ts` and optionally `sessions.ts`. Run full test suite.

**Rollback**: Each phase is independently revertible. Phase 1 is purely additive. Phases 2-4 can be reverted by restoring the previous file versions — no database or infrastructure changes involved.
