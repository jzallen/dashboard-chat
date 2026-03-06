## Why

All frontend source code lives under `src/lib/`, which acts as an arbitrary wrapper adding no meaningful organization. Auth infrastructure (`lib/auth/`) and its React context (`ui/context/AuthContext/`) are split across locations despite being related concerns. Query hooks have inter-dependencies (e.g., `useDatasetMutations` imports `datasetKeys` from `useDatasetQuery`) that make them tightly coupled.

Adopting a layer-first `core/ + ui/ + lib/` structure creates a clear technology boundary: pure TypeScript in `core/`, React code in `ui/`, and generic infrastructure in `lib/`. Dependency flow: `ui/ → core/ → lib/`. Never the reverse.

## What Changes

- **BREAKING** Rename `src/lib/shared/` → `src/lib/http/` (alias `@/shared` → `@/http`)
- **BREAKING** Rename `src/lib/raqb/` → `src/lib/queryTranslation/` (alias `@/raqb` → `@/queryTranslation`)
- **BREAKING** Rename `src/lib/table-tools/` → `src/core/toolCalls/` (alias `@/table-tools` → `@/toolCalls`)
- Move `src/lib/auth/` → `src/core/auth/` (alias `@/auth` target changes, name preserved)
- Move `src/lib/dataCatalog/` → `src/core/dataCatalog/` (alias `@/dataCatalog` target changes, name preserved)
- Move `src/lib/chat/` → `src/core/chat/` (alias `@/chat` target changes, name preserved)
- Move `src/lib/ui/context/ChatContext/services/` → `src/core/chat/services/` (pure TS, no React)
- Move `src/lib/ui/` → `src/ui/` (drop the `lib/` wrapper)
- Extract `queryKeys.ts` from individual hook files to decouple inter-hook dependencies
- Restructure `src/test/` to mirror new source layout

## Capabilities

### New Capabilities
_None — this is a restructure of existing code, not new functionality._

### Modified Capabilities
- `frontend-module-layout`: Directory structure changes from flat `lib/` to layered `core/ + ui/ + lib/`. Path aliases renamed and retargeted. Module boundaries redefined around technology layers rather than a single `lib/` namespace. Hook decoupling via queryKeys extraction.

## Impact

- **Path aliases**: 3 renamed (`@/shared` → `@/http`, `@/raqb` → `@/queryTranslation`, `@/table-tools` → `@/toolCalls`), 3 retargeted (`@/auth`, `@/dataCatalog`, `@/chat`)
- **Config files**: `vite.config.ts`, `tsconfig.json` must be updated in sync
- **Import statements**: ~28 import sites across frontend need updating for renamed aliases
- **Test files**: Mirror structure changes, import path updates
- **No runtime behavior changes**: Pure structural refactor
