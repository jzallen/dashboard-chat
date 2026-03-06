## ADDED Requirements

### Requirement: Frontend lib directory structure
The frontend `src/lib/` directory SHALL be organized into bounded-context modules, each representing a distinct system concern.

The required top-level modules SHALL be:
- `shared/` — Generic infrastructure (ApiClient class, ApiError)
- `chat/` — Chat worker communication (types, prompts, session CRUD, SSE streaming)
- `dataCatalog/` — Backend data catalog operations (datasets, projects, sqlAccess, uploads)
- `auth/` — Authentication (providers, middleware, token management)
- `table-tools/` — Client-side table operations
- `raqb/` — Query builder integration

#### Scenario: Each module has a single responsibility
- **WHEN** a developer inspects the `src/lib/` directory
- **THEN** each subdirectory SHALL contain code for exactly one bounded context
- **AND** no module SHALL mix concerns from different system boundaries (e.g., chat session CRUD SHALL NOT live in `dataCatalog/`)

### Requirement: Path alias conventions
The frontend SHALL define TypeScript path aliases and Vite resolve aliases for each `lib/` module, configured in both `tsconfig.json` and `vite.config.ts`.

The alias mapping SHALL be:
| Alias | Target |
|-------|--------|
| `@/shared` | `src/lib/shared` |
| `@/chat` | `src/lib/chat` |
| `@/dataCatalog` | `src/lib/dataCatalog` |
| `@/table-tools` | `src/lib/table-tools` |
| `@/raqb` | `src/lib/raqb` |

The `@/api` alias SHALL NOT exist.

#### Scenario: Aliases resolve in TypeScript compilation
- **WHEN** `npx tsc --noEmit` is run
- **THEN** all alias imports SHALL resolve without errors

#### Scenario: Aliases resolve in Vite dev server and build
- **WHEN** `npm run build` or `npm run dev` is run
- **THEN** all alias imports SHALL resolve correctly via Vite's `resolve.alias` configuration

### Requirement: Module import boundaries
External consumers (components, hooks, tests outside a module) SHALL import from a module's barrel export (`index.ts`) or from specific public files, never from internal implementation files.

The `dataCatalog/index.ts` barrel SHALL export:
- All domain functions (`getDataset`, `listProjects`, `uploadFile`, `exportDbtProject`, etc.)
- All domain types (`Dataset`, `Project`, `SchemaConfig`, `Transform`, `SqlAccessStatus`, etc.)
- `ApiError` (public error contract)

The `dataCatalog/index.ts` barrel SHALL NOT export:
- `ApiClient` class
- Standalone `get`, `post`, `patch`, `del` functions
- `backendClient` instance

#### Scenario: Consumer imports domain function from barrel
- **WHEN** a hook imports `getDataset` from `@/dataCatalog`
- **THEN** the import SHALL resolve to the domain function in `dataCatalog/datasets.ts`

#### Scenario: Consumer cannot import ApiClient from barrel
- **WHEN** code attempts to import `ApiClient` from `@/dataCatalog`
- **THEN** the import SHALL fail because `ApiClient` is not exported from the barrel

### Requirement: Shared ApiClient lives in lib/shared with no auth dependency
The `ApiClient` class and `ApiError` class SHALL be defined in `lib/shared/apiClient.ts`. This file SHALL NOT instantiate any client and SHALL NOT import from `auth/`. It SHALL accept an optional `fetchFn` parameter in its constructor, defaulting to the global `fetch`.

### Requirement: Domain modules use factory pattern with injectable fetch
`dataCatalog/client.ts` SHALL export a `createDataCatalog(fetchFn)` factory function that returns an object with all domain methods bound to an internal `ApiClient`. `chat/client.ts` SHALL export a `createChatClient(fetchFn)` factory function with the same pattern.

Call sites (hooks, components) SHALL create factory instances with the appropriate auth wrapper:
- Authenticated routes: `createDataCatalog(withAuth(fetch))`
- Pre-auth routes (login, callback): `createDataCatalog(fetch)` (plain fetch)
- SSE streaming: `createChatClient(withEagerAuth(fetch))`

#### Scenario: dataCatalog factory creates a client
- **WHEN** a hook calls `createDataCatalog(withAuth(fetch))`
- **THEN** the factory SHALL create an `ApiClient` with `DATA_CATALOG_BASE_URL`, `{ unwrapData: true, fetchFn }` internally
- **AND** return an object with all domain methods (`getDataset`, `listProjects`, etc.)

#### Scenario: chat factory creates a client
- **WHEN** a hook calls `createChatClient(fetchFn)`
- **THEN** the factory SHALL create an `ApiClient` with `CHAT_BASE_URL`, `{ unwrapData: false, fetchFn }` internally
- **AND** return an object with session CRUD and streaming methods

### Requirement: No auth imports in shared, chat, or dataCatalog
The following directories SHALL NOT contain any imports from `auth/`:
- `lib/shared/`
- `lib/chat/`
- `lib/dataCatalog/`

Auth wrapping is the responsibility of the call site, not the domain module.

#### Scenario: grep confirms no auth coupling
- **WHEN** `grep -r "from.*auth" frontend/src/lib/shared/ frontend/src/lib/chat/ frontend/src/lib/dataCatalog/` is run
- **THEN** it SHALL return zero matches

### Requirement: Config constants use domain-specific names
`shared/config.ts` SHALL export:
- `DATA_CATALOG_BASE_URL` (reads from `VITE_API_URL` env var)
- `CHAT_BASE_URL` (reads from `VITE_CHAT_URL` env var)

The old names `API_BASE_URL` and `CHAT_URL` SHALL NOT exist anywhere in the codebase.

### Requirement: No cross-workspace shared/chat package
The `shared/chat/` npm workspace package SHALL be dissolved. The root `package.json` workspaces array SHALL NOT include `shared/chat`. The `shared/chat/package.json` file SHALL be deleted.

Worker-only code (`handleChat.ts`, `clients/groq.ts`, `createChatHandler`) SHALL live in `worker/lib/chat/`.
Frontend-only code (`types.ts`, `prompts.ts`) SHALL live in `frontend/src/lib/chat/`.

#### Scenario: Worker imports handler locally
- **WHEN** the worker's `index.ts` needs `createChatHandler`
- **THEN** it SHALL import from `./lib/chat` (local to worker)
- **AND** SHALL NOT import from `../shared/chat` or `dashboard-chat-shared`

#### Scenario: npm install succeeds without shared/chat workspace
- **WHEN** `npm install` is run at the repo root
- **THEN** it SHALL succeed without the `shared/chat` workspace entry
- **AND** no package SHALL declare a dependency on `dashboard-chat-shared`
