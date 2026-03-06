## 1. Create shared infrastructure

- [x] 1.1 Create `frontend/src/lib/shared/apiClient.ts` — move `ApiClient` class and `ApiError` from `lib/api/client.ts`. Remove the `backendClient` instance and standalone function exports (those move to `dataCatalog/client.ts`). Export only `ApiClient` and `ApiError`.
- [x] 1.2 Move `frontend/src/lib/api/config.ts` → `frontend/src/lib/shared/config.ts` (contains `API_BASE_URL` and `CHAT_URL` — generic env-var constants, not domain logic).
- [x] 1.3 Add `@/shared` path alias to `vite.config.ts` (`resolve.alias`) and `tsconfig.json` (`paths`) pointing to `src/lib/shared`.

## 2. Create dataCatalog module

- [x] 2.1 Rename directory `frontend/src/lib/api/` → `frontend/src/lib/dataCatalog/`.
- [x] 2.2 Rewrite `dataCatalog/client.ts` — import `ApiClient` from `@/shared/apiClient`, import `API_BASE_URL` from `@/shared/config`, create `backendClient` instance with `{ unwrapData: true }`. Export standalone `get`, `post`, `patch`, `del`, `uploadFile` for use by sibling modules only. Delete `dataCatalog/config.ts` (moved to shared).
- [x] 2.3 Update `dataCatalog/index.ts` barrel — export from `./datasets`, `./projects`, `./sqlAccess`. Re-export `ApiError` from `@/shared/apiClient`. Do NOT export from `./client` (no `get`/`post`/`ApiClient`/`backendClient`). Remove export of `./chat`.
- [x] 2.4 Update internal imports in `dataCatalog/datasets.ts`, `dataCatalog/projects.ts`, `dataCatalog/sqlAccess.ts` — verify they import from `./client` (should already be correct after rename).
- [x] 2.5 Update path aliases: change `@/api` → `@/dataCatalog` in `vite.config.ts` and `tsconfig.json`. Remove the old `@/api` alias entirely.

## 3. Create chat module

- [x] 3.1 Create `frontend/src/lib/chat/` directory.
- [x] 3.2 Move `shared/chat/types.ts` → `frontend/src/lib/chat/types.ts` (identical content).
- [x] 3.3 Move `shared/chat/prompts.ts` → `frontend/src/lib/chat/prompts.ts`. Update its import of types to `./types`.
- [x] 3.4 Move `frontend/src/lib/dataCatalog/chat.ts` → `frontend/src/lib/chat/client.ts`. Update `ApiClient` import to `@/shared/apiClient`. Update `CHAT_URL` import to `@/shared/config`. Update types import from `@/chat/types` to `./types`.
- [x] 3.5 Create `frontend/src/lib/chat/index.ts` barrel — re-export from `./types`, `./prompts`, `./client`.
- [x] 3.6 Update `@/chat` path alias in `vite.config.ts` to point to `src/lib/chat` (was `../shared/chat`). Update `tsconfig.json` paths for `@/chat` and `@/chat/*` to point to `src/lib/chat` and `src/lib/chat/*`.

## 4. Move worker chat handler

- [x] 4.1 Create `worker/lib/chat/` directory.
- [x] 4.2 Move `shared/chat/handleChat.ts` → `worker/lib/chat/handleChat.ts`. Update its import of prompts to `./prompts`. Update its import of types to `./types`.
- [x] 4.3 Move `shared/chat/clients/groq.ts` → `worker/lib/chat/clients/groq.ts`. Update any imports.
- [x] 4.4 Create `worker/lib/chat/types.ts` with the minimal type subset needed by the handler: `Message`, `ToolDefinition`, `ToolCall`, `TableSchema`, `CASE_OPERATIONS`.
- [x] 4.5 Copy `shared/chat/prompts.ts` → `worker/lib/chat/prompts.ts`. Update its import of types to `./types`.
- [x] 4.6 Create `worker/lib/chat/index.ts` — export `createChatHandler`, `handleChat`, `GroqChatClient`, `ChatClient`, `ChatCompletionRequest`.
- [x] 4.7 Update `worker/index.ts` import from `"../shared/chat/index"` → `"./lib/chat"`.

## 5. Remove shared/chat workspace package

- [x] 5.1 Delete the `shared/chat/` directory entirely (all files already moved).
- [x] 5.2 Remove `"shared/chat"` from the `workspaces` array in root `package.json`.
- [x] 5.3 Remove `"dashboard-chat-shared": "*"` from `worker/package.json` dependencies (if present).
- [x] 5.4 Remove `"dashboard-chat-shared": "*"` from `frontend/package.json` dependencies (if present).
- [x] 5.5 Run `npm install` at repo root to regenerate `package-lock.json`.

## 6. Update frontend imports

- [x] 6.1 Update all `@/api` barrel imports → `@/dataCatalog` across components, hooks, and test files (~30 files). Use grep for `from ["']@/api["']` to find them all.
- [x] 6.2 Update `@/api/chat` imports → `@/chat` (SessionViewer, SessionList, useChatEngine, sessionLogger).
- [x] 6.3 Update `@/api/datasets` imports → `@/dataCatalog/datasets` (executeToolCall.ts, executeToolCall.test.tsx).
- [x] 6.4 Update `@/chat/types` and `@/chat/prompts` imports — these keep the same alias but now resolve to `lib/chat/` instead of `shared/chat/`. Verify no path changes needed.
- [x] 6.5 Update `lib/auth/tokenRefresh.ts` import of `API_BASE_URL` from `"../api/config"` → `"../shared/config"`.
- [x] 6.6 Update `lib/ui/data/config.ts` import from `"../../api/config"` → `"../../shared/config"`.
- [x] 6.7 Update `AuthProvider.tsx` — change import from `"../../../api/client"` → import `backendClient` from `"../../../dataCatalog/client"`. Replace bare `get()`/`post()` calls with `backendClient.get()`/`backendClient.post()`. Import `API_BASE_URL` from `"../../../shared/config"` for logout fetch.
- [x] 6.8 Update `CreateOrg/index.tsx` — change import from `"../../../api/client"` → import `backendClient` from `"../../../dataCatalog/client"`. Replace `post()` with `backendClient.post()`.

## 7. Update tests

- [x] 7.1 Move `frontend/src/test/chat/handleChat.test.ts` → `worker/test/chat/handleChat.test.ts`. Update imports from `@/chat/index` → local `../../lib/chat`.
- [x] 7.2 Move `frontend/src/test/chat/clients/groq.test.ts` → `worker/test/chat/clients/groq.test.ts`. Update imports.
- [x] 7.3 Update `frontend/src/test/api/chat.test.ts` imports from `"../../lib/api/chat"` → `"../../lib/chat/client"` and `"../../lib/api/client"` → `"../../lib/shared/apiClient"`. Consider renaming test directory from `test/api/` to `test/chat/` if no other api tests remain.
- [x] 7.4 Update `frontend/src/test/auth/apiClientAuth.test.ts` import from `"../../lib/api/client"` → `"../../lib/shared/apiClient"`.
- [x] 7.5 Update `frontend/src/test/auth/tokenInterceptor.test.ts` import from `"../../lib/api/client"` → `"../../lib/shared/apiClient"`.
- [x] 7.6 Update `frontend/src/test/ui/components/UploadWidget.test.tsx` mock path from `"../../../lib/api/client"` → `"../../../lib/dataCatalog/client"`.
- [x] 7.7 Update `frontend/src/lib/api/__tests__/exportDbtProject.test.ts` — move to `frontend/src/lib/dataCatalog/__tests__/exportDbtProject.test.ts`, update import from `"../projects"` (should still work after directory rename).

## 8. Verify

- [x] 8.1 Run `cd frontend && npx tsc --noEmit` — no new type errors.
- [x] 8.2 Run `cd frontend && npx vitest run` — all frontend tests pass.
- [x] 8.3 Run `cd worker && npm test` — all worker tests pass (including moved handler tests).
- [x] 8.4 Run `grep -r "@/api" frontend/src/` — zero matches (alias fully removed).
- [x] 8.5 Run `grep -r "shared/chat" frontend/src/ worker/` — zero matches (no cross-workspace references).
- [x] 8.6 Verify `shared/chat/` directory no longer exists.

## 9. Decouple auth from shared/apiClient

- [x] 9.1 Add `fetchFn` parameter to `ApiClient` constructor in `shared/apiClient.ts`. Signature: `constructor(baseUrl: string, options?: { unwrapData?: boolean; fetchFn?: typeof fetch })`. Default `fetchFn` to global `fetch`. Replace all internal `this.authedFetch` usage with `this.fetchFn`. Remove the `import { withAuth }` from `"../auth/withAuth"` and the `private get authedFetch()` getter entirely.
- [x] 9.2 Rename config constants in `shared/config.ts`: `API_BASE_URL` → `DATA_CATALOG_BASE_URL`, `CHAT_URL` → `CHAT_BASE_URL`. Env var names (`VITE_API_URL`, `VITE_CHAT_URL`) stay unchanged.
- [x] 9.3 Update all imports of `API_BASE_URL` and `CHAT_URL` across the codebase to use the new names. Files: `dataCatalog/client.ts`, `chat/client.ts`, `auth/tokenRefresh.ts`, `ui/data/config.ts`, `AuthProvider.tsx`, and any test files referencing these constants.

## 10. Convert dataCatalog to factory pattern

- [x] 10.1 Rewrite `dataCatalog/client.ts` — replace the `backendClient` singleton and standalone `get`/`post`/`patch`/`del`/`uploadFile` exports with a `createDataCatalog(fetchFn: typeof fetch = fetch)` factory function. The factory creates an `ApiClient` internally and returns an object with all domain methods: `listDatasets`, `getDataset`, `updateDataset`, `createTransform`, `updateTransform`, `deleteTransform`, `toggleTransform`, `previewCleaningTransform`, `createCleaningTransforms`, `listDatasetsForProject`, `listProjects`, `getProject`, `exportDbtProject`, `enableSqlAccess`, `disableSqlAccess`, `getSqlAccess`, `syncSqlAccess`, `regenerateSqlCredentials`, `startEnvironment`, `stopEnvironment`, `restartEnvironment`, `getEnvironmentStatus`, `getOrgInfo`, `uploadFile`.
- [x] 10.2 Refactor `dataCatalog/datasets.ts`, `dataCatalog/projects.ts`, `dataCatalog/sqlAccess.ts` — each domain function should accept a `client: ApiClient` parameter (passed by the factory) instead of importing standalone `get`/`post`/`patch`/`del` from `./client`. Alternatively, inline the method bodies directly into the factory return object in `client.ts` if the files become trivially small.
- [x] 10.3 Add `getOrgInfo()` to the catalog — currently `useOrgQuery.ts` calls bare `get<OrgInfo>("/api/orgs/me")`. Move this into the factory as `getOrgInfo: () => client.get<OrgInfo>("/api/orgs/me")`.
- [x] 10.4 Update `dataCatalog/index.ts` barrel — export `createDataCatalog` from `./client`, continue exporting all domain types from `./datasets`, `./projects`, `./sqlAccess`. Export `ApiError` from `@/shared/apiClient`. Do NOT export standalone functions (`getDataset`, `listProjects`, etc.) — these now live on the factory return type.
- [x] 10.5 Export the `DataCatalog` interface type from the barrel — the return type of `createDataCatalog`, so hooks can type their catalog instances.

## 11. Convert chat to factory pattern

- [x] 11.1 Rewrite `chat/client.ts` — replace the `chatClient` singleton and standalone exports with a `createChatClient(fetchFn: typeof fetch = fetch)` factory function. The factory creates an `ApiClient` internally and returns: `createSession`, `logTurn`, `getSession`, `listSessions`, `fetchChatStream`. For `fetchChatStream`, the factory uses the provided `fetchFn` directly (no separate `withEagerAuth` import).
- [x] 11.2 Update `chat/index.ts` barrel — export `createChatClient` from `./client`. Remove standalone function exports (`createSession`, `logTurn`, etc.). Continue exporting types and prompts.
- [x] 11.3 Export the `ChatClient` interface type from the barrel.

## 12. Update call sites to use factories with auth

- [x] 12.1 Update `useDatasetQuery.ts` — import `createDataCatalog` from `@/dataCatalog` and `withAuth` from `@/auth`. Create catalog instance with `createDataCatalog(withAuth(fetch))`. Replace direct `getDataset(...)` / `listDatasetsForProject(...)` calls with `catalog.getDataset(...)` / `catalog.listDatasetsForProject(...)`.
- [x] 12.2 Update `useProjectQuery.ts` — same pattern: create catalog, use `catalog.getProject(...)`.
- [x] 12.3 Update `useOrgQuery.ts` — create catalog with `withAuth(fetch)`. Replace `get<OrgInfo>("/api/orgs/me")` with `catalog.getOrgInfo()`. Replace `listProjects()` with `catalog.listProjects()`. Remove import of `get` from `@/dataCatalog/client`.
- [x] 12.4 Update `useDatasetMutations.ts` — create catalog, use `catalog.updateDataset(...)`.
- [x] 12.5 Update `useSqlAccessQuery.ts` — create catalog, use catalog methods for sqlAccess operations.
- [x] 12.6 Update `useTransforms.ts` — create catalog, use catalog methods for transform CRUD.
- [x] 12.7 Update `UploadWidget.tsx` — create catalog with `withAuth(fetch)`, use `catalog.uploadFile(...)`. Remove import from `@/dataCatalog/client`.
- [x] 12.8 Update `DatasetView/index.tsx` — replace `exportDbtProject(...)` with catalog method.
- [x] 12.9 Update `TransformSettings/index.tsx` — replace `getDataset(...)` with catalog method.
- [x] 12.10 Update `useChatEngine.tsx` — import `createChatClient` from `@/chat` and `withEagerAuth` from `@/auth`. Create chat client with `createChatClient(withEagerAuth(fetch))` for streaming, or `createChatClient(withAuth(fetch))` for session CRUD. Replace standalone `createSession`, `logTurn`, `fetchChatStream` calls with client methods.
- [x] 12.11 Update `sessionLogger.ts` — use chat client factory.
- [x] 12.12 Update `SessionViewer/index.tsx` and `SessionList.tsx` — use chat client factory for `getSession` / `listSessions`.
- [x] 12.13 Update `AuthProvider.tsx` — for login/callback (pre-auth endpoints), use `createDataCatalog(fetch)` with plain fetch (no `withAuth`). For logout, continue using raw `fetch` with manual `Authorization` header. Remove import of `backendClient` from `dataCatalog/client`.
- [x] 12.14 Update `CreateOrg/index.tsx` — use `createDataCatalog(withAuth(fetch))` for `catalog.createOrg(...)` (add `createOrg` to factory), or use `ApiClient` from `@/shared/apiClient` directly. Remove import of `backendClient`.
- [x] 12.15 Update `executeToolCall.ts` — if it imports from `@/dataCatalog/datasets`, update to use the factory or verify it only imports types (which don't change).

## 13. Update tests for factory pattern

- [x] 13.1 Update `test/auth/apiClientAuth.test.ts` — `ApiClient` no longer auto-wraps with `withAuth`. Tests should create `new ApiClient(url, { fetchFn: mockFetch })` and verify behavior with the injected fetch. Remove any `vi.mock("../auth/withAuth")` patching.
- [x] 13.2 Update `test/auth/tokenInterceptor.test.ts` — same: inject mock fetch instead of mocking auth internals.
- [x] 13.3 Update `test/api/chat.test.ts` — test `createChatClient(mockFetch)` factory. Verify session CRUD and stream methods use the provided fetch.
- [x] 13.4 Update `test/ui/components/UploadWidget.test.tsx` — mock `@/dataCatalog` factory instead of `@/dataCatalog/client`.
- [x] 13.5 Update any other test files that mock `@/dataCatalog/client` or `@/shared/apiClient` internals to use the factory injection pattern instead.

## 14. Verify auth decoupling

- [x] 14.1 Run `grep -r "from.*auth" frontend/src/lib/shared/` — zero matches.
- [x] 14.2 Run `grep -r "from.*auth" frontend/src/lib/dataCatalog/` — zero matches.
- [x] 14.3 Run `grep -r "from.*auth" frontend/src/lib/chat/` — zero matches.
- [x] 14.4 Run `grep -r "API_BASE_URL\|CHAT_URL" frontend/src/` — zero matches (old constant names fully removed).
- [x] 14.5 Run `cd frontend && npx tsc --noEmit` — no new type errors.
- [x] 14.6 Run `cd frontend && npx vitest run` — all frontend tests pass.

## Backlog (out of scope)

The following is deferred to a future change to avoid scope creep:

- **Restructure `lib/` into `features/`, `ui/`, `lib/`**: The current `lib/` conflates domain modules (auth, chat, dataCatalog, table-tools) with generic infrastructure (shared/) and UI code (ui/). A cleaner layout would be:
  - `features/` — domain modules: `auth/`, `chat/`, `dataCatalog/`, `toolCalls/` (renamed table-tools)
  - `ui/` — React components, hooks, context, providers
  - `lib/` — generic infrastructure only: `http/` (ApiClient), `logging/`, `config/`
