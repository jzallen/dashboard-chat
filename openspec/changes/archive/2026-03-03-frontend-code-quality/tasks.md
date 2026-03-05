# Tasks: Frontend Code Quality

## Phase 1: Type Safety at Boundaries

- [ ] 1.1 Define `ToolCallArgs` discriminated union in `frontend/src/lib/table-tools/types.ts`. One variant per tool: `filterTable`, `sortTable`, `addRow`, `deleteRows`, `searchTable`, `resetFilters`, `resetSort`, `activateCleaningTool`. Include the existing `ToolCallHandlers` interface updates if needed.
- [ ] 1.2 Add `validateToolCallArgs(name: string, raw: Record<string, unknown>): ToolCallArgs` function in `frontend/src/lib/table-tools/executeToolCall.ts`. Each case validates required fields and throws a descriptive error if missing. Replace all `args as { ... }` casts in `performTableAction` with calls to this validator.
- [ ] 1.3 Extend `TanStackFilterValue` in `frontend/src/lib/table-tools/types.ts` to a discriminated union: single-condition form (`{ operator, value, transformId? }`) and compound form (`{ conditions: Array<{ operator, value, transformId? }> }`). Add `isCompoundFilter()` type guard.
- [ ] 1.4 Update `customFilterFn` in `frontend/src/lib/table-tools/customFilterFn.ts`: use `isCompoundFilter()` type guard instead of the current `isCompound()`. Change `default` case in operator switch to return `false` and log a warning instead of returning `true`.
- [ ] 1.5 Remove the `as unknown as TanStackFilterValue` double assertion in `frontend/src/lib/raqb/raqbToTanstack.ts` (line ~213). The compound form now fits the union natively.
- [ ] 1.6 Define `ExpressionConfig` discriminated union in `frontend/src/lib/api/datasets.ts`: variants for `trim`, `case`, `fill_null`, `map_values`, `alias`. Update the `Transform` type to use `expression_config: ExpressionConfig | null`.
- [ ] 1.7 Update `useTableConfig.ts` alias map computation: replace `(t.expression_config as Record<string, unknown>).alias as string` with type-narrowed access via the `ExpressionConfig` union.
- [ ] 1.8 Define typed interfaces in `frontend/src/lib/api/sessions.ts`: `ToolDefinition` (for `tool_definitions`), reuse `ToolCall` type (for `tool_calls`), `TableSchema` (for `table_schema`). Replace all `object` and `object[]` usages in `ChatTurnPayload` and `ChatTurn`.
- [ ] 1.9 Run `npm run build` to verify no TypeScript compilation errors from type changes.

## Phase 2: TanStack Query Alignment

- [ ] 2.1 Create `QUERY_STALE_TIMES` constant in `frontend/src/lib/ui/hooks/queryConfig.ts` (new file): `PROJECT`, `DATASET_LIST`, `DATASET_DETAIL`, `TRANSFORMS`, `SQL_ACCESS` with documented rationale for each value.
- [ ] 2.2 Add `ApiError` as the error generic to all query hooks: `useDatasetQuery` (`useQuery<Dataset, ApiError>`), `useProjectQuery`, `useOrgProjectsQuery`, `useSqlAccessQuery`, `useEnvironmentStatus`. Import `ApiError` from the API client module.
- [ ] 2.3 Fix non-null assertions in query keys. In `useDatasetQuery.ts`: replace `datasetKeys.detail(datasetId!)` with conditional construction or `skipToken`. Same for `useSqlAccessQuery.ts`. Ensure no `undefined` values appear in query keys.
- [ ] 2.4 Apply `QUERY_STALE_TIMES` constants to all hooks, replacing inline numeric values (`30_000`, `10_000`, `5 * 60 * 1000`).
- [ ] 2.5 Refactor `useTransforms.ts`: replace manual `queryClient.setQueryData()` calls with `useMutation` hooks. Create `useSaveTransform(datasetId)`, `useToggleTransform(datasetId)`, `useDeleteTransform(datasetId)` — each with `onMutate` (optimistic update with `cancelQueries`), `onError` (rollback), `onSettled` (invalidation with `exact: true`). Remove the `onDatasetChange` callback pattern.
- [ ] 2.6 Update `DatasetView/index.tsx` to use the new mutation hooks from 2.5 instead of the old `useTransforms` callbacks.
- [ ] 2.7 Add `exact: true` to all targeted cache invalidation calls across hooks and `executeToolCall.ts`. Leave family-level invalidation (`datasetKeys.all`) without `exact`.
- [ ] 2.8 Run `cd frontend && npx vitest run` to verify no test regressions from query hook changes.

## Phase 3: RAQB Conversion Correctness

- [ ] 3.1 Fix `escapeIdentifier()` in `frontend/src/lib/raqb/toSql.ts`: replace character stripping with double-quote SQL quoting. `escapeIdentifier(id)` → `'"' + id.replace(/"/g, '""') + '"'`.
- [ ] 3.2 Update existing `toSql` tests to expect quoted identifiers in output.
- [ ] 3.3 Modify `raqbToTanstack` return type to `{ filters: Array<{ id: string; value: TanStackFilterValue }>, warnings: string[] }`. Add a warning when an OR conjunction group is encountered. Update all call sites to destructure `{ filters, warnings }`.
- [ ] 3.4 Create `frontend/src/test/raqb/tanstackToRaqb.test.ts`: tests for `filterTableToRaqb()` (single filter, multiple filters, compound filter value, empty array) and `generateFilterDescription()`.
- [ ] 3.5 Add at least one round-trip test: RAQB tree → `raqbToTanstack` → `filterTableToRaqb` → verify semantic equivalence.
- [ ] 3.6 Run `cd frontend && npx vitest run` to verify RAQB tests pass.

## Phase 4: React Patterns and Cleanup

- [ ] 4.1 Split the large `useEffect` in `DatasetView/index.tsx` (around lines 155-212): extract alias map to `useMemo` (depends on `dataset?.transforms`), extract active filter list to `useMemo` (depends on `columnFilters`), keep only `registerTableSchema` call in the `useEffect`.
- [ ] 4.2 Replace fire-and-forget async IIFEs in `DatasetView`'s `executeToolCall` callback with calls to the mutation hooks from Phase 2 task 2.5.
- [ ] 4.3 Fix token refresh race in `frontend/src/lib/api/fetchUtils.ts`: change `setTimeout(() => { refreshPromise = null; }, 500)` to `refreshPromise = null` (synchronous clear in `.finally()`).
- [ ] 4.4 In `ChatContext.tsx` `handleSubmit`: capture `toolHandlerRef.current`, `tableSchemaRef.current`, and `projectUpdaterRef.current` into local variables before the SSE stream loop. Use the captured values throughout stream processing.
- [ ] 4.5 In `ChatContext.tsx` catch block: set `sessionIdRef.current = null` on SSE stream error.
- [ ] 4.6 In `DatasetView/Breadcrumb.tsx`: replace `<span role="button" onKeyDown={...}>` with `<button>` elements for clickable breadcrumb items. Remove manual Enter key handling.
- [ ] 4.7 Wrap `ChatPanel` export in `React.memo`. Wrap `removeFilter` in `ActiveFilters/index.tsx` with `useCallback`. Wrap `scroll` in `DatasetCarousel/index.tsx` with `useCallback`.
- [ ] 4.8 Fix `CopyButton` timer leak in `SqlAccessPanel/index.tsx`: move the `setTimeout` into a `useEffect` that returns a cleanup function.

## Phase 5: Consistency Pass

- [ ] 5.1 Create `frontend/src/lib/errors.ts` with `getErrorMessage(error: unknown): string`. Replace ad-hoc error message extraction in `ChatContext.tsx`, `AuthContext.tsx`, and any other catch blocks that use `instanceof Error ? err.message : "Unknown error"` or `String(e)`.
- [ ] 5.2 Consolidate URL constants: ensure `API_BASE_URL` and `CHAT_URL` are both exported from a single module (e.g., `frontend/src/lib/api/config.ts` or extend existing). Update imports in `client.ts`, `fetchUtils.ts`, and `ChatContext.tsx`.
- [ ] 5.3 Convert `CreateOrg/index.tsx` and `LoginPage/index.tsx` from inline `style={{}}` to CSS modules, matching the pattern used by all other components.
- [ ] 5.4 Remove `loading: false` and `error: null` from the `useTableConfig` return object.
- [ ] 5.5 Extract `CASE_OPERATIONS = ["upper", "lower", "title", "snake", "kebab"] as const` to a shared location (e.g., `table-tools/types.ts` or `shared/chat/constants.ts`). Import in both `executeToolCall.ts` and `prompts.ts`.
- [ ] 5.6 Add `aria-label="Remove filter"` to the remove button in `FilterBadge.tsx`.

## Phase 6: Verification

- [ ] 6.1 Run full frontend test suite: `cd frontend && npx vitest run`.
- [ ] 6.2 Run full build: `npm run build` — verify no TypeScript errors.
- [ ] 6.3 Grep for remaining `as unknown as` casts in table-tools and raqb modules — should be zero.
- [ ] 6.4 Grep for remaining `Record<string, unknown>` in `executeToolCall.ts` — should be zero (except for `addRow.data` which is legitimately dynamic).
- [ ] 6.5 Grep for remaining `object[]` or `: object` types in `sessions.ts` — should be zero.
- [ ] 6.6 Grep for remaining inline `style={{` in components — should only exist in components outside scope of this change.
- [ ] 6.7 Manual smoke test: open a dataset → apply filters via chat → verify filters work → apply a transform via chat → verify transform persists → switch projects → verify cache behavior.
