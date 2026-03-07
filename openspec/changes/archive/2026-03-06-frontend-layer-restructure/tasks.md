## 1. Foundation Renames (lib layer)

- [x] 1.1 Move `src/lib/shared/` → `src/lib/http/` (apiClient.ts, config.ts, index.ts)
- [x] 1.2 Move `src/lib/raqb/` → `src/lib/queryTranslation/` (all 6 files)
- [x] 1.3 Update `vite.config.ts`: change `@/shared` alias to `@/http` → `src/lib/http`, change `@/raqb` alias to `@/queryTranslation` → `src/lib/queryTranslation`
- [x] 1.4 Update `tsconfig.json` path mappings to match vite alias changes
- [x] 1.5 Search-replace all `@/shared` imports → `@/http` across frontend/src/ (~4 import sites: dataCatalog/client.ts, chat/client.ts, ui/data/config.ts, and any others)
- [x] 1.6 Search-replace all `@/raqb` imports → `@/queryTranslation` across frontend/src/ (~11 import sites in table-tools, dataCatalog, ui/components, ui/hooks)
- [x] 1.7 Run `cd frontend && npx vitest run` and `npm run build` to verify

## 2. Extract queryKeys (decouple hooks)

- [x] 2.1 Create `src/lib/ui/hooks/queryKeys.ts` exporting `projectKeys`, `datasetKeys`, `orgKeys`, `sqlAccessKeys` (extract from useProjectQuery.ts, useDatasetQuery.ts, useOrgQuery.ts, useSqlAccessQuery.ts)
- [x] 2.2 Update `useProjectQuery.ts` to import `projectKeys` from `./queryKeys` instead of defining it locally
- [x] 2.3 Update `useDatasetQuery.ts` to import `datasetKeys` from `./queryKeys` instead of defining it locally
- [x] 2.4 Update `useOrgQuery.ts` to import `orgKeys` from `./queryKeys` instead of defining it locally
- [x] 2.5 Update `useSqlAccessQuery.ts` to import `sqlAccessKeys` from `./queryKeys` instead of defining it locally
- [x] 2.6 Update `useDatasetMutations.ts` to import `datasetKeys` from `./queryKeys` instead of from `./useDatasetQuery`
- [x] 2.7 Update `useTransforms.ts` to import `datasetKeys` from `./queryKeys` instead of from `./useDatasetQuery`
- [x] 2.8 Update any other files importing key factories from hook files (e.g., `executeToolCall.ts` imports `datasetKeys` — point it to the new queryKeys location)
- [x] 2.9 Run tests to verify cache invalidation still works correctly

## 3. Move core/auth (pure TS)

- [x] 3.1 Create `src/core/auth/` directory
- [x] 3.2 Move `src/lib/auth/*` → `src/core/auth/` (tokenStorage.ts, tokenRefresh.ts, withAuth.ts, types.ts, index.ts)
- [x] 3.3 Update `vite.config.ts`: change `@/auth` alias target from `src/lib/auth` to `src/core/auth`
- [x] 3.4 Update `tsconfig.json` path mapping for `@/auth`
- [x] 3.5 Remove empty `src/lib/auth/` directory
- [x] 3.6 Run tests to verify (no consumer import changes needed — alias name preserved)

## 4. Move core/dataCatalog (pure TS)

- [x] 4.1 Create `src/core/dataCatalog/` directory
- [x] 4.2 Move `src/lib/dataCatalog/*` → `src/core/dataCatalog/` (client.ts, projects.ts, datasets.ts, sqlAccess.ts, index.ts, __tests__/)
- [x] 4.3 Update `vite.config.ts`: change `@/dataCatalog` alias target from `src/lib/dataCatalog` to `src/core/dataCatalog`
- [x] 4.4 Update `tsconfig.json` path mapping for `@/dataCatalog`
- [x] 4.5 Remove empty `src/lib/dataCatalog/` directory
- [x] 4.6 Run tests to verify

## 5. Move core/chat (pure TS + services)

- [x] 5.1 Verify ChatContext services are pure TS: `grep -r "from 'react'" frontend/src/lib/ui/context/ChatContext/services/` should return zero matches. If any file has React imports, it stays in ui/ — adjust subsequent tasks accordingly.
- [x] 5.2 Create `src/core/chat/` and `src/core/chat/services/` directories
- [x] 5.3 Move `src/lib/chat/*` → `src/core/chat/` (client.ts, prompts.ts, types.ts, index.ts)
- [x] 5.4 Move `src/lib/ui/context/ChatContext/services/*` → `src/core/chat/services/` (chatStream.ts, toolExecution.ts, sessionLogger.ts)
- [x] 5.5 Update `vite.config.ts`: change `@/chat` alias target from `src/lib/chat` to `src/core/chat`
- [x] 5.6 Update `tsconfig.json` path mapping for `@/chat`
- [x] 5.7 Fix imports in `useChatEngine.tsx` — service imports change from relative `../services/` to `@/chat/services/`
- [x] 5.8 Update `core/chat/index.ts` barrel to re-export services if needed by external consumers
- [x] 5.9 Remove empty `src/lib/chat/` directory and `src/lib/ui/context/ChatContext/services/` directory
- [x] 5.10 Run tests to verify

## 6. Move core/toolCalls (rename table-tools)

- [x] 6.1 Create `src/core/toolCalls/` directory
- [x] 6.2 Move `src/lib/table-tools/*` → `src/core/toolCalls/` (executeToolCall.ts, customFilterFn.ts, types.ts, index.ts)
- [x] 6.3 Update `vite.config.ts`: replace `@/table-tools` alias with `@/toolCalls` → `src/core/toolCalls`
- [x] 6.4 Update `tsconfig.json` path mapping: replace `@/table-tools` with `@/toolCalls`
- [x] 6.5 Search-replace all `@/table-tools` imports → `@/toolCalls` across frontend/src/ (~13 import sites in ui/components, ui/context, ui/hooks, ui/types.ts)
- [x] 6.6 Remove empty `src/lib/table-tools/` directory
- [x] 6.7 Run tests to verify

## 7. Move ui/ layer out of lib/

- [x] 7.1 Move `src/lib/ui/components/` → `src/ui/components/`
- [x] 7.2 Move `src/lib/ui/context/` → `src/ui/context/` (AuthContext + ChatContext, minus already-moved services)
- [x] 7.3 Move `src/lib/ui/hooks/` → `src/ui/hooks/` (includes queryKeys.ts from Phase 2)
- [x] 7.4 Move `src/lib/ui/providers/` → `src/ui/providers/`
- [x] 7.5 Move `src/lib/ui/types.ts` → `src/ui/types.ts`
- [x] 7.6 Move `src/lib/ui/common.module.css` → `src/ui/common.module.css`
- [x] 7.7 Move `src/lib/ui/data/` → `src/ui/data/`
- [x] 7.8 Fix all relative imports within ui/ that reference sibling directories (components ↔ hooks, context → hooks, etc.) — paths shift up one level since `lib/` wrapper is removed
- [x] 7.9 Update `App.tsx` and `main.tsx` imports if they use relative paths to lib/ui/ components
- [x] 7.10 Delete empty `src/lib/ui/` directory. If `src/lib/` only contains `http/` and `queryTranslation/`, confirm and leave it.
- [x] 7.11 Run tests and build to verify

## 8. Restructure tests

- [x] 8.1 Move `src/test/raqb/` → `src/test/lib/queryTranslation/`
- [x] 8.2 Move `src/test/table-tools/` → `src/test/core/toolCalls/`
- [x] 8.3 Move `src/test/auth/` → `src/test/core/auth/`
- [x] 8.4 Move `src/test/api/chat.test.ts` → `src/test/core/chat/chat.test.ts`
- [x] 8.5 Move `src/test/ui/context/ChatContext.test.tsx` → `src/test/ui/context/ChatContext.test.tsx` (stays — already in ui/)
- [x] 8.6 Update import paths in all moved test files to use new aliases (`@/http`, `@/queryTranslation`, `@/toolCalls`)
- [x] 8.7 Run full test suite: `cd frontend && npx vitest run`
- [x] 8.8 Run build: `npm run build`
- [x] 8.9 Final verification: `grep -r "lib/ui\|lib/auth\|lib/chat\|lib/shared\|lib/raqb\|lib/table-tools\|lib/dataCatalog" frontend/src/` returns zero matches
- [x] 8.10 Final verification: `grep -r "@/shared\|@/raqb\|@/table-tools" frontend/src/` returns zero matches
