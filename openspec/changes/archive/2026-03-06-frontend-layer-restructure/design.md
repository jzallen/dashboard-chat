## Context

The frontend `src/lib/` directory currently acts as a flat namespace containing everything: pure TS utilities (auth, dataCatalog, chat, table-tools, raqb, shared), React components, contexts, hooks, and providers. There is no structural distinction between framework-independent business logic and React integration code.

Additionally, query hooks have inter-dependencies — `useDatasetMutations` and `useTransforms` both import `datasetKeys` from `useDatasetQuery`, coupling hooks that should be independent.

The existing spec `frontend-module-layout` defines the current `lib/` structure. This change replaces it with a layered architecture.

## Goals / Non-Goals

**Goals:**
- Establish a layer-first architecture with strict dependency direction: `ui/ → core/ → lib/`
- Separate pure TypeScript (`core/`) from React code (`ui/`) to improve testability
- Rename misleading modules (`raqb` → `queryTranslation`, `shared` → `http`, `table-tools` → `toolCalls`)
- Decouple query hooks by extracting shared key factories into `queryKeys.ts`
- Keep each migration phase independently committable and testable

**Non-Goals:**
- Changing any runtime behavior or API contracts
- Reorganizing React components within `ui/components/` (internal component structure stays)
- Moving query hooks out of `ui/hooks/` (they stay as a shared React data access sublayer)
- Adding new features or capabilities

## Decisions

### 1. Three-layer architecture: `core/` + `ui/` + `lib/`

**Decision**: Organize `src/` into three top-level directories with strict dependency rules.

| Layer | Contains | React Imports? |
|-------|----------|---------------|
| `lib/` | Generic infrastructure (HTTP client, format converters) | No |
| `core/` | Domain logic (API clients, types, services) | No |
| `ui/` | Components, contexts, hooks, providers | Yes |

**Why `core/` over `features/`**: "Features" implies vertical slices (feature folders). This is a horizontal layer — the framework-independent center in Clean Architecture terms. `core/` communicates the right intent.

**Why not consolidate contexts into `core/`**: React contexts (AuthContext, ChatContext) are integration points where pure TS meets React. Keeping them in `ui/` enforces the `ui/ → core/` dependency direction and ensures `core/` has zero React imports.

**Alternative considered**: Consolidating everything per domain (auth infra + AuthProvider in `features/auth/`). Rejected because it mixes React into the core layer and makes the technology boundary unclear.

### 2. ChatContext services move to `core/chat/services/`

**Decision**: `chatStream.ts`, `toolExecution.ts`, and `sessionLogger.ts` move from `ui/context/ChatContext/services/` to `core/chat/services/`.

**Why**: These files are pure TypeScript — no React hooks or components. They belong in the core layer. The React hook `useChatEngine` stays in `ui/` and imports from `@/chat/services/`.

**Prerequisite**: Verify these files contain no React imports before moving. If any do, they stay in `ui/`.

### 3. Query hooks stay in `ui/hooks/`, decoupled via `queryKeys.ts`

**Decision**: All query hooks remain in a flat `ui/hooks/` folder. Extract query key factories into a new `queryKeys.ts` to break inter-hook dependencies.

**Current coupling**:
```
useDatasetMutations.ts → imports datasetKeys from useDatasetQuery.ts
useTransforms.ts → imports datasetKeys from useDatasetQuery.ts
```

**After extraction**: Each hook imports from `queryKeys.ts` only, never from sibling hooks.

**Why flat folder**: At 10 files, domain subfolders add overhead without benefit. The inter-hook coupling was the real problem, not the folder structure.

### 4. Alias strategy: preserve names where possible

**Decision**: Keep `@/auth`, `@/dataCatalog`, `@/chat` alias names (just retarget). Rename only `@/shared` → `@/http`, `@/raqb` → `@/queryTranslation`, `@/table-tools` → `@/toolCalls`.

**Why**: Preserving alias names means consumers using those aliases need zero import text changes. Only ~28 import sites need updating (for the 3 renamed aliases), instead of all ~70+.

### 5. Eight-phase incremental migration

**Decision**: Execute as 8 independently committable phases, ordered by the dependency graph.

| Phase | What | Why this order |
|-------|------|---------------|
| 1 | Rename `lib/shared/` → `lib/http/`, `lib/raqb/` → `lib/queryTranslation/` | Foundation layer, no dependents to break |
| 2 | Extract `queryKeys.ts` | Decouple hooks before anything moves |
| 3 | Move `lib/auth/` → `core/auth/` | Independent module, no inter-core deps |
| 4 | Move `lib/dataCatalog/` → `core/dataCatalog/` | Independent module |
| 5 | Move `lib/chat/` → `core/chat/` + ChatContext services | Depends on alias being available |
| 6 | Move `lib/table-tools/` → `core/toolCalls/` | After dataCatalog (imports datasetKeys) |
| 7 | Move `lib/ui/` → `ui/` | After all core modules settled |
| 8 | Restructure tests | Mirror final source layout |

## Risks / Trade-offs

**[Risk: ChatContext services may not be pure TS]** → Before Phase 5, grep for React imports in `chatStream.ts`, `toolExecution.ts`, `sessionLogger.ts`. If any import React hooks, they stay in `ui/`.

**[Risk: vite.config.ts / tsconfig.json alias desync]** → Update both files in the same commit, always. Desync breaks either build or IDE.

**[Risk: Phase 7 has highest churn]** → All `ui/` content moves up one level. Relative imports between components, hooks, and contexts may need adjustment. Run full test suite after this phase.

**[Risk: Stale references after migration]** → After all phases, grep for old paths (`lib/ui`, `lib/auth`, `lib/chat`, etc.) to catch any missed references.

**[Trade-off: `core/` has no alias]** → Modules in `core/` are accessed via their domain aliases (`@/auth`, `@/dataCatalog`, etc.), not a `@/core` alias. This is intentional — consumers shouldn't need to know about the layer.
