# frontend-module-layout Specification

## Purpose
Defines the three-layer module structure for the frontend `src/` directory (lib → core → ui), including path aliases, import boundaries, shared infrastructure placement, and the factory pattern for domain API clients.

## Requirements

### Requirement: Frontend directory structure
The frontend `src/` directory SHALL be organized into three top-level layers with strict dependency rules:

| Layer | Purpose | React Imports Allowed? |
|-------|---------|----------------------|
| `lib/` | Generic infrastructure (HTTP client, format converters) | No |
| `core/` | Domain logic (API clients, types, services) | No |
| `ui/` | React components, contexts, hooks, providers | Yes |

The dependency flow SHALL be `ui/ → core/ → lib/`. No reverse dependencies SHALL exist.

The required `core/` modules SHALL be:
- `auth/` — Authentication (token storage, refresh, withAuth decorator, types)
- `dataCatalog/` — Backend data catalog operations (client factory, datasets, projects, sqlAccess)
- `chat/` — Chat worker communication (client factory, types, prompts, services: chatStream, toolExecution, sessionLogger)
- `toolCalls/` — Client-side tool call execution and custom filter functions

The required `lib/` modules SHALL be:
- `http/` — Generic HTTP infrastructure (ApiClient class, ApiError, config/base URLs)
- `queryTranslation/` — Stateless format conversion between RAQB JSON, TanStack filters, and SQL

The `ui/` layer SHALL contain:
- `components/` — React component directories
- `context/AuthContext/` — AuthProvider, useAuth hook, token state hooks
- `context/ChatContext/` — ChatProvider, useChatContext hook, useChatEngine hook
- `hooks/` — Shared query hooks and table configuration hooks
- `providers/` — QueryProvider (TanStack Query)
- `types.ts`, `common.module.css`, `data/config.ts`

#### Scenario: core/ contains no React imports
- **WHEN** `grep -r "from 'react'" frontend/src/core/` is run
- **THEN** it SHALL return zero matches

#### Scenario: lib/ contains no React imports
- **WHEN** `grep -r "from 'react'" frontend/src/lib/` is run
- **THEN** it SHALL return zero matches

#### Scenario: No reverse dependencies exist
- **WHEN** files in `src/core/` are inspected
- **THEN** no file SHALL import from `src/ui/`
- **AND** no file in `src/lib/` SHALL import from `src/core/` or `src/ui/`

#### Scenario: Old lib/ structure does not exist
- **WHEN** `ls frontend/src/lib/` is run
- **THEN** only `http/` and `queryTranslation/` SHALL exist
- **AND** `auth/`, `chat/`, `dataCatalog/`, `table-tools/`, `raqb/`, `shared/`, `ui/` SHALL NOT exist

### Requirement: Path alias conventions
The frontend SHALL define TypeScript path aliases and Vite resolve aliases for each module, configured in both `tsconfig.json` and `vite.config.ts`.

The alias mapping SHALL be:

| Alias | Target |
|-------|--------|
| `@/http` | `src/lib/http` |
| `@/queryTranslation` | `src/lib/queryTranslation` |
| `@/auth` | `src/core/auth` |
| `@/dataCatalog` | `src/core/dataCatalog` |
| `@/chat` | `src/core/chat` |
| `@/toolCalls` | `src/core/toolCalls` |

The following aliases SHALL NOT exist: `@/shared`, `@/raqb`, `@/table-tools`, `@/api`.

#### Scenario: Aliases resolve in TypeScript compilation
- **WHEN** `npx tsc --noEmit` is run
- **THEN** all alias imports SHALL resolve without errors

#### Scenario: Aliases resolve in Vite dev server and build
- **WHEN** `npm run build` or `npm run dev` is run
- **THEN** all alias imports SHALL resolve correctly via Vite's `resolve.alias` configuration

#### Scenario: Old aliases are not present
- **WHEN** `grep -r "@/shared\|@/raqb\|@/table-tools" frontend/src/` is run
- **THEN** it SHALL return zero matches

### Requirement: Module import boundaries
External consumers (components, hooks, tests outside a module) SHALL import from a module's barrel export (`index.ts`) or from specific public files, never from internal implementation files.

The `dataCatalog/index.ts` barrel SHALL export:
- Factory function `createDataCatalog`
- All domain types (`Dataset`, `Project`, `SchemaConfig`, `Transform`, `SqlAccessStatus`, etc.)
- `ApiError` (public error contract)

The `dataCatalog/index.ts` barrel SHALL NOT export:
- `ApiClient` class
- Standalone `get`, `post`, `patch`, `del` functions

#### Scenario: Consumer imports domain function from barrel
- **WHEN** a hook imports `createDataCatalog` from `@/dataCatalog`
- **THEN** the import SHALL resolve to the factory in `core/dataCatalog/client.ts`

### Requirement: Shared ApiClient lives in lib/http with no auth dependency
The `ApiClient` class and `ApiError` class SHALL be defined in `lib/http/apiClient.ts`. This file SHALL NOT instantiate any client and SHALL NOT import from `auth/`. It SHALL accept an optional `fetchFn` parameter in its constructor, defaulting to the global `fetch`.

#### Scenario: ApiClient has no auth coupling
- **WHEN** `grep -r "from.*auth" frontend/src/lib/http/` is run
- **THEN** it SHALL return zero matches

### Requirement: Domain modules use factory pattern with injectable fetch
`core/dataCatalog/client.ts` SHALL export a `createDataCatalog(fetchFn)` factory function that returns an object with all domain methods bound to an internal `ApiClient`. `core/chat/client.ts` SHALL export a `createChatClient(fetchFn)` factory function with the same pattern.

Call sites (hooks, components) SHALL create factory instances with the appropriate auth wrapper:
- Authenticated routes: `createDataCatalog(withAuth(fetch))`
- Pre-auth routes: `createDataCatalog(fetch)`
- SSE streaming: `createChatClient(withEagerAuth(fetch))`

#### Scenario: dataCatalog factory creates a client
- **WHEN** a hook calls `createDataCatalog(withAuth(fetch))`
- **THEN** the factory SHALL create an `ApiClient` with `DATA_CATALOG_BASE_URL` internally
- **AND** return an object with all domain methods

### Requirement: No auth imports in lib/http, core/chat, or core/dataCatalog
The following directories SHALL NOT contain any imports from `auth/`:
- `lib/http/`
- `core/chat/`
- `core/dataCatalog/`

Auth wrapping is the responsibility of the call site, not the domain module.

#### Scenario: grep confirms no auth coupling
- **WHEN** `grep -r "from.*auth" frontend/src/lib/http/ frontend/src/core/chat/ frontend/src/core/dataCatalog/` is run
- **THEN** it SHALL return zero matches

### Requirement: Config constants use domain-specific names
`lib/http/config.ts` SHALL export:
- `DATA_CATALOG_BASE_URL` (reads from `VITE_API_URL` env var)
- `CHAT_BASE_URL` (reads from `VITE_CHAT_URL` env var)

#### Scenario: Config exports correct constants
- **WHEN** `lib/http/config.ts` is inspected
- **THEN** it SHALL export `DATA_CATALOG_BASE_URL` and `CHAT_BASE_URL`

### Requirement: No cross-workspace shared/chat package
The `shared/chat/` npm workspace package SHALL be dissolved. The root `package.json` workspaces array SHALL NOT include `shared/chat`. Worker-only code SHALL live in `worker/lib/chat/`. Frontend-only code SHALL live in `core/chat/`.

#### Scenario: npm install succeeds without shared/chat workspace
- **WHEN** `npm install` is run at the repo root
- **THEN** it SHALL succeed without the `shared/chat` workspace entry

### Requirement: Query hook independence via queryKeys extraction
All TanStack Query key factories (`projectKeys`, `datasetKeys`, `orgKeys`, `sqlAccessKeys`) SHALL be defined in a single `ui/hooks/queryKeys.ts` file.

Individual query hooks SHALL import key factories from `queryKeys.ts`, never from sibling hook files. No hook file in `ui/hooks/` SHALL import from another hook file in the same directory.

#### Scenario: No inter-hook imports exist
- **WHEN** imports in `ui/hooks/use*.ts` files are inspected
- **THEN** no hook file SHALL import from another `use*.ts` file in the same directory
- **AND** key factories SHALL be imported from `./queryKeys`

#### Scenario: queryKeys.ts exports all key factories
- **WHEN** `ui/hooks/queryKeys.ts` is inspected
- **THEN** it SHALL export `projectKeys`, `datasetKeys`, `orgKeys`, and `sqlAccessKeys`

### Requirement: ChatContext services are pure TypeScript in core/
The chat services (`chatStream.ts`, `toolExecution.ts`, `sessionLogger.ts`) SHALL reside in `core/chat/services/`. These files SHALL NOT import from `react` or any React library.

The React hook `useChatEngine` in `ui/context/ChatContext/` SHALL import these services via the `@/chat` alias.

#### Scenario: Chat services have no React dependency
- **WHEN** `grep -r "from 'react'" frontend/src/core/chat/services/` is run
- **THEN** it SHALL return zero matches

#### Scenario: useChatEngine imports services from core
- **WHEN** `useChatEngine.tsx` imports are inspected
- **THEN** service imports SHALL use the `@/chat/services/` path

### Requirement: Test directory mirrors source structure
The `src/test/` directory SHALL mirror the `src/` source layout:

| Source Path | Test Path |
|-------------|-----------|
| `core/auth/` | `test/core/auth/` |
| `core/chat/` | `test/core/chat/` |
| `core/toolCalls/` | `test/core/toolCalls/` |
| `lib/queryTranslation/` | `test/lib/queryTranslation/` |
| `ui/components/` | `test/ui/components/` |
| `ui/context/` | `test/ui/context/` |

#### Scenario: Test files are in correct directories
- **WHEN** test files are inspected
- **THEN** each test file SHALL reside in a directory that mirrors the source file's location relative to `src/`
