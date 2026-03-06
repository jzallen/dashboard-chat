## Context

The frontend `lib/` directory currently has a flat `api/` module that mixes three concerns: a generic HTTP client (`ApiClient` class, `ApiError`), backend data catalog operations (datasets, projects, sqlAccess), and chat worker communication (sessions, streaming). The `shared/chat/` workspace package at the repo root is declared as shared between frontend and worker, but analysis shows zero runtime code sharing — the worker uses the handler/client, and the frontend uses types/prompts.

A recent refactor already introduced the `ApiClient` class and consolidated `chatClient.ts` into `chat.ts`, but the module boundaries remain blurred. External consumers import bare `get`/`post` from the barrel, and auth code reaches directly into `api/client.ts`.

### Current state

```
shared/chat/                    ← npm workspace "dashboard-chat-shared"
  handleChat.ts, clients/groq.ts  → used only by worker
  types.ts, prompts.ts            → used only by frontend
  index.ts, package.json

frontend/src/lib/
  api/                          ← single module for everything
    client.ts                   → ApiClient class + backendClient instance + standalone delegates
    chat.ts                     → chatClient instance + session CRUD + fetchChatStream
    datasets.ts, projects.ts, sqlAccess.ts, config.ts, index.ts
  auth/                         → imports from ../api/client and ../api/config
```

### Path aliases (current)

| Alias | Target |
|-------|--------|
| `@/api` | `src/lib/api` |
| `@/chat` | `../shared/chat` (cross-workspace) |
| `@/table-tools` | `src/lib/table-tools` |
| `@/raqb` | `src/lib/raqb` |

## Goals / Non-Goals

**Goals:**
- Each frontend `lib/` subdirectory represents a distinct bounded context with explicit dependencies
- `@/chat` alias points to the frontend's own chat module (types, prompts, API client, session CRUD)
- Generic `ApiClient` infrastructure lives in `lib/shared/` — imported by `dataCatalog`, `chat`, and `auth`
- Worker owns its chat handler code directly — no cross-workspace package dependency
- The barrel export from `@/dataCatalog` exposes only domain functions and types, not `ApiClient`/`get`/`post`

**Non-Goals:**
- Changing any runtime behavior, API contracts, or component logic
- Moving `lib/auth/` files beyond updating their imports
- Changing the worker's Hono routes or middleware

## Decisions

### 1. Target directory structure

```
frontend/src/lib/
  shared/
    apiClient.ts              → ApiClient class, ApiError (no instances, no auth import)
    config.ts                 → DATA_CATALOG_BASE_URL, CHAT_BASE_URL (env-var constants)
  chat/
    index.ts                  → barrel: re-exports types, prompts, createChatClient factory
    types.ts                  → moved from shared/chat/types.ts
    prompts.ts                → moved from shared/chat/prompts.ts
    client.ts                 → createChatClient(fetchFn) factory + session/stream methods
  dataCatalog/
    index.ts                  → barrel: createDataCatalog factory + domain types (NOT ApiClient)
    client.ts                 → createDataCatalog(fetchFn) factory, internal ApiClient usage
    datasets.ts, projects.ts, sqlAccess.ts → accept client param from factory
  auth/                       → existing files, updated imports only
  table-tools/                → unchanged
  raqb/                       → unchanged

worker/
  lib/chat/
    index.ts                  → createChatHandler (moved from shared/chat/index.ts)
    handleChat.ts             → moved from shared/chat/handleChat.ts
    clients/groq.ts           → moved from shared/chat/clients/groq.ts
    types.ts                  → minimal type definitions needed by handler
```

**Rationale**: Each directory is a cohesive domain. `shared/` contains only framework-level code (the generic HTTP client with no auth dependency). `chat/` and `dataCatalog/` expose factory functions that accept a `fetchFn`, making auth injectable by the caller. No domain module imports from `auth/`. No circular dependencies.

### 2. Path alias mapping

| Alias | New Target | Old Target |
|-------|-----------|------------|
| `@/chat` | `src/lib/chat` | `../shared/chat` |
| `@/dataCatalog` | `src/lib/dataCatalog` | n/a |
| `@/shared` | `src/lib/shared` | n/a |
| `@/api` | **removed** | `src/lib/api` |
| `@/table-tools` | unchanged | unchanged |
| `@/raqb` | unchanged | unchanged |

**Rationale**: `@/chat` is the most natural alias and should point to the frontend's chat module, not a cross-workspace package. Removing `@/api` forces consumers to migrate — no silent fallback to the old structure.

### 3. Worker gets its own copy of chat handler code

Move `shared/chat/{handleChat.ts, clients/groq.ts}` into `worker/lib/chat/` rather than making worker import from the frontend. The worker needs its own `types.ts` with the minimal subset (Message, ToolDefinition, TableSchema, ToolCall) needed by `handleChat.ts`.

**Alternative considered**: Keep `shared/chat/` but split into `shared/chat-types/` (truly shared) and `shared/chat-handler/` (worker-only). Rejected because the types aren't actually shared — the frontend types come from the prompts/tool definitions context, and the worker types come from the handler context. Duplicating ~30 lines of type definitions is preferable to maintaining a cross-workspace package.

### 4. `dataCatalog/index.ts` barrel exports factory + types, not `ApiClient`

The barrel exports:
- `createDataCatalog` factory function
- All domain types (`Dataset`, `Project`, `SchemaConfig`, `Transform`, `SqlAccessStatus`, etc.)
- `ApiError` (public error contract used by TanStack Query hooks)

The `ApiClient` class, internal `get`/`post`/`patch`/`del` helpers, and `backendClient` instance are gone from the public surface. Consumers create a catalog via the factory.

**Files that currently reach into `dataCatalog/client` directly:**
- `AuthProvider.tsx` → uses `backendClient.get/post` for login/callback. Switch to `createDataCatalog(fetch)` (plain fetch, no auth — these are auth bootstrap endpoints) or use `ApiClient` from `@/shared/apiClient` directly
- `CreateOrg/index.tsx` → uses `backendClient.post` for org creation. Switch to `createDataCatalog(withAuth(fetch))` or add `createOrg` to the catalog
- `useOrgQuery.ts` → uses bare `get` for `/api/orgs/me`. Add `getOrgInfo()` to the catalog factory
- `UploadWidget.tsx` → uses `uploadFile` from client. Switch to catalog method

### 5. `config.ts` moves to `shared/` with renamed constants

Constants move from `dataCatalog/config.ts` to `shared/config.ts` and get renamed to match their domain:
- `API_BASE_URL` → `DATA_CATALOG_BASE_URL` (env var stays `VITE_API_URL`)
- `CHAT_URL` → `CHAT_BASE_URL` (env var stays `VITE_CHAT_URL`)

These are generic env-var-to-constant mappings with no domain logic. Having `chat/` import from `@/dataCatalog/config` would create an inappropriate cross-module dependency — domain modules should only depend on `shared/`, not on each other. The rename makes each constant self-documenting about which service it targets.

### 6. Auth decoupling via factory pattern — no domain module imports from `auth/`

`shared/`, `chat/`, and `dataCatalog/` SHALL NOT import from `auth/`. Auth is a cross-cutting concern applied at the call site, not baked into API clients.

**Current state (problematic):**
```
shared/apiClient.ts → import { withAuth } from "../auth/withAuth"   ❌
chat/client.ts      → import { withEagerAuth } from "../auth/withAuth" ❌
```

**Target state — factory pattern:**

Domain modules expose factory functions that accept a `fetchFn` parameter. The factory creates an `ApiClient` internally and returns an object with bound domain methods. Callers never see `ApiClient`.

```typescript
// dataCatalog/client.ts
export function createDataCatalog(fetchFn: typeof fetch = fetch) {
  const client = new ApiClient(DATA_CATALOG_BASE_URL, { fetchFn, unwrapData: true });
  return {
    getDataset: (id, opts?) => ...,
    listProjects: () => ...,
    uploadFile: (endpoint, file, fields) => ...,
    // ... all domain methods
  };
}

// chat/client.ts
export function createChatClient(fetchFn: typeof fetch = fetch) {
  const client = new ApiClient(CHAT_BASE_URL, { fetchFn, unwrapData: false });
  return {
    createSession: (projectId, datasetId?) => ...,
    listSessions: (datasetId) => ...,
    fetchChatStream: (messages, schema) => ...,
    // ... all chat methods
  };
}
```

**Call sites (hooks, components) decide auth:**
```typescript
// In a hook
import { withAuth } from "@/auth";
import { createDataCatalog } from "@/dataCatalog";

const catalog = createDataCatalog(withAuth(fetch));
const dataset = await catalog.getDataset(id);
```

**Auth endpoints (login, callback, logout) use plain fetch** — no `withAuth` wrapper, since these are the endpoints that establish auth in the first place.

**Benefits:**
1. **Clean dependency graph** — `shared/`, `chat/`, `dataCatalog/` have zero auth imports
2. **Injectable fetch for tests** — pass a mock fetch directly, no `vi.mock("../auth/withAuth")` patching
3. **Progressive auth migration** — when routes move behind an API gateway, call sites switch from `withAuth(fetch)` to plain `fetch` one at a time, minimizing blast radius

## Risks / Trade-offs

**[Large import churn]** → ~40 files need import updates. Mitigated by: mechanical find-and-replace, TypeScript compiler catches all broken imports, full test suite validates.

**[Worker type duplication]** → Worker's `types.ts` duplicates ~30 lines from frontend's `types.ts`. Mitigated by: types are stable (Message, ToolCall, TableSchema haven't changed), and divergence is acceptable since they serve different contexts.

**[Test file moves]** → `frontend/src/test/chat/handleChat.test.ts` and `groq.test.ts` test the handler code that moves to the worker. These tests must move with the code. Mitigated by: tests follow the code, no logic changes.

**[npm workspace removal]** → Removing `shared/chat` from workspaces changes `package-lock.json`. Mitigated by: run `npm install` after removing the workspace entry to regenerate the lockfile cleanly.

**[Factory boilerplate at call sites]** → Each hook/component that calls domain functions must create a factory instance with `withAuth(fetch)`. Some duplication across hooks. Mitigated by: explicit is better than implicit — each call site documents its auth requirement. The duplication is intentional and enables progressive migration to API gateway auth.

**[Config constant rename]** → `API_BASE_URL` → `DATA_CATALOG_BASE_URL` and `CHAT_URL` → `CHAT_BASE_URL` touches every consumer of these constants. Mitigated by: TypeScript compiler catches all references; `tsc --noEmit` validates completeness.

## Open Questions

None — all decisions are informed by the codebase analysis performed in this session.
