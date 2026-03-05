## 1. Setup

- [x] 1.1 Add `clsx` dependency: `cd frontend && npm install clsx`
- [x] 1.2 Verify existing tests pass before changes: `cd frontend && npx vitest run`

## 2. Conditional Logic — DatasetView

- [x] 2.1 Replace className ternary chain on sync button (line ~431) with `clsx` conditional-object pattern
- [x] 2.2 Consolidate repeated `viewMode === "table" &&` guards (lines ~407-443) into a single conditional fragment
- [x] 2.3 Extract named predicates for complex boolean expressions in `activeCleaningTransforms` filter/map chain (lines ~189-199)
- [x] 2.4 Extract sync state machine callback (`handleSync`, lines ~273-285) into a flat sequence with named timer helpers
- [x] 2.5 Run `npx vitest run` — no test changes allowed in this group

## 3. Conditional Logic — ChatContext

- [x] 3.1 Extract token refresh pre-check (lines ~144-159) into a named async helper `refreshAuthHeadersIfExpiring()`
- [x] 3.2 Extract 401 retry flow (lines ~175-199) into a named async helper `retryOn401()`
- [x] 3.3 Flatten `sendMessage` to a flat early-return sequence using the extracted helpers
- [x] 3.4 Run `npx vitest run` — no test changes allowed in this group

## 4. Conditional Logic — executeToolCall

- [x] 4.1 Replace `validateToolCallArgs` switch statement (lines 14-72) with a declarative validator map keyed by tool name
- [x] 4.2 Promote the section comments (`// --- Table tool actions ---`, `// --- Cleaning tools ---`) to JSDoc on their respective functions
- [x] 4.3 Run `npx vitest run` — no test changes allowed in this group

## 5. Conditional Logic — Remaining Files

- [x] 5.1 Extract named predicate in `useTransforms.ts` guard clause (line ~225): `const isApplicableFilter = ...`
- [x] 5.2 Extract named predicate in `useTransforms.ts` `applyTransform` guard (line ~188-190)
- [x] 5.3 Simplify `SqlAccessPanel` connectionString fallback (lines ~233-237) with a named helper or extracted variable
- [x] 5.4 Replace any remaining multi-ternary className patterns found during review with `clsx` (none found — all remaining are single-conditional, acceptable per spec)
- [x] 5.5 Run `npx vitest run` — no test changes allowed in this group

## 6. JSDoc — Hooks

- [x] 6.1 Add JSDoc to `useProjectQuery` and `projectKeys` in `useProjectQuery.ts`
- [x] 6.2 Add JSDoc to `useDatasetQuery`, `useDatasets`, `usePrefetchDataset`, and `datasetKeys` in `useDatasetQuery.ts`
- [x] 6.3 Add JSDoc to `useOrgQuery` and `useOrgProjectsQuery` in `useOrgQuery.ts`
- [x] 6.4 Add JSDoc to all hooks in `useSqlAccessQuery.ts` (7 hooks)
- [x] 6.5 Add JSDoc to `useTableConfig` and `UseTableConfigOptions` in `useTableConfig.ts`
- [x] 6.6 Add JSDoc to `useTransforms`, `UseTransformsOptions`, `UseTransformsReturn`, and mutation hooks in `useTransforms.ts`
- [x] 6.7 Add JSDoc to `useRenameDataset` in `useDatasetMutations.ts`

## 7. JSDoc — Context and Auth

- [x] 7.1 Add JSDoc to `ChatProvider`, `useChatContext`, `ChatContextValue`, and `ToolHandler` in `ChatContext.tsx`
- [x] 7.2 Add JSDoc to `AuthProvider`, `useAuth`, `AuthContextValue` in `AuthContext.tsx`
- [x] 7.3 Add JSDoc to `AuthUser` and `AuthState` in `auth/types.ts`

## 8. JSDoc — Table Tools

- [x] 8.1 Add JSDoc to `executeToolCall`, `validateToolCallArgs`, `performTableAction`, `handleCleaningTool` in `executeToolCall.ts`
- [x] 8.2 Add JSDoc to `ToolCallArgs`, `ToolCallHandlers`, `TransformInfo`, `ToolCallContext`, `TableRow` in `table-tools/types.ts`
- [x] 8.3 Add JSDoc to `customFilterFn` and `evaluateCondition` in `customFilterFn.ts`

## 9. JSDoc — Components

- [x] 9.1 Add JSDoc to `DatasetView` component and its props interface
- [x] 9.2 Add JSDoc to `ChatPanel`, `MessageBubble`, `ChatEmptyState` components
- [x] 9.3 Add JSDoc to `TablePanel`, `Pagination`, `ActiveFilters` components
- [x] 9.4 Add JSDoc to `SideNav` component and its props interface
- [x] 9.5 Add JSDoc to `SqlAccessPanel` component
- [x] 9.6 Add JSDoc to `OrgView`, `ProjectGrid`, `ProjectCard` components
- [x] 9.7 Add JSDoc to remaining exported components: `SessionViewer`, `TransformSettings`, `CreateOrg`, `LogoutPage`

## 10. JSDoc — Inline Comment Promotion

- [x] 10.1 Scan for `//` comments that describe exported function purposes and promote to `/** */` JSDoc (section comments in executeToolCall.ts already promoted in task 4.2; remaining inline comments are eslint directives or internal — no further promotions needed)
- [x] 10.2 Remove promoted inline comments to avoid duplication (already done in task 4.2)

## 11. Verification

- [x] 11.1 Run full frontend test suite: `cd frontend && npx vitest run`
- [x] 11.2 Run TypeScript type-check: `cd frontend && npx tsc --noEmit`
- [x] 11.3 Spot-check that `clsx` imports are used correctly (no runtime behavior change)
- [x] 11.4 Verify JSDoc renders correctly in IDE hover tooltips for 3-5 key exports
