## Why

The frontend `lib/api/` directory conflates three distinct concerns — backend data catalog operations, chat worker communication, and a generic HTTP client — into a single module. Meanwhile, `shared/chat/` is declared as cross-service shared code but nothing is actually shared at runtime: the worker uses `handleChat`/`GroqChatClient`, and the frontend uses `types`/`prompts`. This false sharing couples two independent services through a package boundary, and the flat `lib/api/` barrel makes it impossible for consumers to express which system they depend on.

## What Changes

- **Dissolve `shared/chat/` npm workspace package**: Move worker-only code (`handleChat.ts`, `clients/groq.ts`, `index.ts`) into `worker/lib/chat/`. Move frontend-only code (`types.ts`, `prompts.ts`) into `frontend/src/lib/chat/`.
- **Extract generic `ApiClient`**: Move `ApiClient` class and `ApiError` from `lib/api/client.ts` to `lib/shared/apiClient.ts` — a service-agnostic HTTP client with auth, error handling, and `unwrapData` option.
- **Rename `lib/api/` → `lib/dataCatalog/`**: The remaining modules (datasets, projects, sqlAccess, uploads) become a domain-specific package for backend data catalog operations, with its own `client.ts` instantiating `ApiClient` for `API_BASE_URL`.
- **Create `lib/chat/`**: Houses the chat worker API client (session CRUD, SSE streaming) alongside the types and prompts moved from `shared/chat/`. Uses its own `ApiClient` instance for `CHAT_URL`.
- **`lib/auth/`**: Update to import `ApiClient` from `lib/shared/apiClient.ts` instead of reaching into `lib/api/client.ts`. **BREAKING** (internal): `AuthProvider` and `CreateOrg` stop importing `get`/`post` from the API module directly.
- **Update path aliases**: `@/api` → `@/dataCatalog`, free `@/chat` to point to `lib/chat/` instead of `shared/chat/`, add `@/shared` for `lib/shared/`.
- **Remove `shared/chat/` from npm workspaces**: Update root `package.json`, remove `shared/chat/package.json`, update `worker/package.json` to drop `dashboard-chat-shared` dependency.

## Capabilities

### New Capabilities

- `frontend-module-layout`: Defines the frontend `lib/` directory structure, path alias conventions, and module boundary rules (which modules can import from which).

### Modified Capabilities

- `chat-worker-client`: Import paths change from `@/api/chat` and `@/api/sessions` to `@/chat`. The chat module now also owns types and prompts previously imported from `@/chat/types` and `@/chat/prompts` (which pointed to `shared/chat/`).

## Impact

- **Frontend**: ~40 files need import path updates (`@/api` → `@/dataCatalog`, `@/api/chat` → `@/chat`, `@/chat/types` → `@/chat/types` same alias new target).
- **Worker**: `index.ts` changes from `import { createChatHandler } from "../shared/chat/index"` to a local `./lib/chat` import.
- **Build config**: `vite.config.ts`, `tsconfig.json` alias updates. Root `package.json` workspaces array drops `shared/chat`.
- **Tests**: `frontend/src/test/chat/` tests that import from `@/chat/index` and `@/chat/clients/groq` need path updates. Worker tests (if any) need updates for moved handler.
- **No runtime behavior changes**: This is a pure structural refactor. All public APIs, types, and functions remain identical.
