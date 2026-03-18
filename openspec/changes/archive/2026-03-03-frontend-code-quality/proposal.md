## Why

A comprehensive code review surfaced systematic type safety gaps, React anti-patterns, and correctness issues across the frontend. The problems cluster into five themes:

1. **Type safety holes at the LLM boundary.** Tool call arguments, filter values, and expression configs are typed as `Record<string, unknown>` and immediately cast with `as`. There's zero compile-time safety where LLM output meets the table engine — if the model omits a required field, the code silently creates broken state (e.g., a filter with `id: undefined`).

2. **TanStack Query anti-patterns.** Transform operations manually call `queryClient.setQueryData()` outside of `useMutation`, bypassing optimistic update rollback. Query hooks don't declare error types. Non-null assertions in query keys create dead cache entries. `staleTime` varies without documented rationale.

3. **RAQB conversion layer correctness.** SQL identifier escaping silently corrupts column names with special characters (strips instead of quoting). OR groups are flattened to AND semantics without warning. The TanStack→RAQB direction has zero test coverage.

4. **React component issues.** Expensive effects recompute on every filter change. Fire-and-forget async calls lack cleanup. Accessibility gaps in keyboard handling. Missing memoization on frequently-rendered components.

5. **Inconsistent patterns.** Error handling varies between `instanceof Error`, `String(e)`, and silent catches. Config URLs split across files. Some components use inline styles while the rest use CSS modules.

## What Changes

### Phase 1: Type safety at boundaries (highest impact)

- **Discriminated unions for tool calls**: Replace `Record<string, unknown>` in `executeToolCall.ts`, `types.ts`, and `customFilterFn.ts` with typed discriminated unions. Add runtime validation at the tool call execution boundary.
- **Typed filter values**: Extend `TanStackFilterValue` to a discriminated union that includes compound filters. Remove the `as unknown as TanStackFilterValue` double assertion in `raqbToTanstack.ts`.
- **Typed session API**: Replace `object` and `object[]` in `sessions.ts` with proper interfaces for tool definitions, tool calls, and table schema.
- **Typed expression configs**: Replace `expression_config: Record<string, unknown> | null` with a discriminated union of operation types in `datasets.ts`.

### Phase 2: TanStack Query alignment

- **Convert useTransforms to useMutation**: Replace manual `queryClient.setQueryData()` in `useTransforms.ts` with proper `useMutation` + `onMutate`/`onError`/`onSettled` for automatic rollback.
- **Add error types**: Add `ApiError` as the error generic to all query hooks (`useDatasetQuery`, `useProjectQuery`, `useOrgQuery`, `useSqlAccessQuery`).
- **Fix query key assertions**: Replace `projectId!` non-null assertions with conditional keys or `skipToken` pattern.
- **Standardize staleTime**: Create a shared `QUERY_STALE_TIMES` constant object and apply consistently.
- **Precise invalidation**: Add `exact: true` to cache invalidation calls that target specific entries.

### Phase 3: RAQB conversion correctness

- **Fix SQL identifier escaping**: Change `escapeIdentifier()` to use proper double-quote SQL quoting instead of character stripping.
- **OR semantics**: Either surface a user-visible warning when OR groups are flattened, or extend `customFilterFn` to support compound OR logic.
- **Add tanstackToRaqb tests**: Cover round-trip conversions and edge cases for `filterTableToRaqb()` and `generateFilterDescription()`.
- **Exhaustive operator handling**: Replace `default: return true` in `customFilterFn.ts` with explicit handling or a warning for unknown operators.

### Phase 4: React patterns and cleanup

- **DatasetView effect splitting**: Extract alias map and active filter computation into separate `useMemo` calls. Keep effect only for registration side-effects.
- **Async cleanup**: Convert fire-and-forget IIFEs in `executeToolCall` callback to `useMutation` or add AbortController.
- **Token refresh race**: Clear `refreshPromise` synchronously in `.finally()` instead of on a 500ms timer.
- **SSE stale closures**: Capture ref values at stream start in `ChatContext.tsx`.
- **SessionId reset**: Clear `sessionIdRef` on SSE error.
- **Accessibility**: Replace `<span role="button">` in Breadcrumb with `<button>`. Add aria-labels to FilterBadge remove buttons.
- **Memoization**: Add `React.memo` to ChatPanel. Wrap `removeFilter` in `useCallback`. Memoize `scroll` handler in DatasetCarousel.
- **Cleanup timers**: Fix `CopyButton` setTimeout leak.

### Phase 5: Consistency pass

- **Error handling utility**: Create a shared `getErrorMessage(error: unknown): string` function. Standardize all catch blocks.
- **Config consolidation**: Move all URL constants to `api/config.ts`.
- **Inline styles**: Convert `CreateOrg` and `LoginPage` from inline styles to CSS modules.
- **Remove dead return values**: Drop `loading: false` and `error: null` from `useTableConfig` return.
- **Shared constants**: Extract `CASE_OPERATIONS` list to a single location shared between `executeToolCall.ts` and `prompts.ts`.

## What Does NOT Change

- **Backend** — no backend code modified. All changes are frontend/shared.
- **API contracts** — no endpoint or response shape changes.
- **RAQB operator approximations** — lossy conversions for `not_like`, `starts_with`, `not_between` remain as-is. These are acceptable given TanStack Table's operator set.
- **Database or migrations** — no schema changes.
- **Auth flow** — auth providers, middleware, and token lifecycle unchanged (except the refresh promise race fix in the fetch utility).

## Impact

**Frontend files modified (~20):**
- `frontend/src/lib/table-tools/types.ts` — discriminated unions
- `frontend/src/lib/table-tools/executeToolCall.ts` — runtime validation, typed args
- `frontend/src/lib/table-tools/customFilterFn.ts` — typed filter values, exhaustive operators
- `frontend/src/lib/raqb/raqbToTanstack.ts` — remove double assertion, OR warning
- `frontend/src/lib/raqb/toSql.ts` — fix identifier escaping
- `frontend/src/lib/raqb/tanstackToRaqb.ts` — (tests only)
- `frontend/src/lib/api/sessions.ts` — typed interfaces
- `frontend/src/lib/api/datasets.ts` — typed expression configs
- `frontend/src/lib/api/fetchUtils.ts` — fix refresh race
- `frontend/src/lib/ui/hooks/useTransforms.ts` — useMutation conversion
- `frontend/src/lib/ui/hooks/useDatasetQuery.ts` — error types, query keys
- `frontend/src/lib/ui/hooks/useProjectQuery.ts` — error types, staleTime
- `frontend/src/lib/ui/hooks/useOrgQuery.ts` — error types
- `frontend/src/lib/ui/hooks/useSqlAccessQuery.ts` — error types, query keys
- `frontend/src/lib/ui/hooks/useTableConfig.ts` — remove dead fields
- `frontend/src/lib/ui/context/ChatContext.tsx` — stale closures, session reset
- `frontend/src/lib/ui/components/DatasetView/index.tsx` — effect splitting, async cleanup
- `frontend/src/lib/ui/components/DatasetView/Breadcrumb.tsx` — accessibility
- `frontend/src/lib/ui/components/ChatPanel/index.tsx` — React.memo
- `frontend/src/lib/ui/components/SqlAccessPanel/index.tsx` — timer cleanup
- `frontend/src/lib/ui/components/TablePanel/ActiveFilters/index.tsx` — useCallback

**New files (~3):**
- `frontend/src/lib/api/config.ts` — consolidated URL constants (or extend existing)
- `frontend/src/lib/errors.ts` — shared error utility
- `frontend/src/test/raqb/tanstackToRaqb.test.ts` — new test file

**Test files modified (~5):**
- Existing RAQB and filter tests updated for new types
- New round-trip conversion tests

**Risk:** LOW. All changes are internal refactoring — no API contract or behavior changes visible to users. Each phase is independently shippable. Type changes may surface additional issues during compilation (which is the point).

## Sequencing

The five phases can be worked in order but are also independently mergeable. Phase 1 (types) should go first as it establishes the foundation that Phases 2-4 build on. Phase 5 (consistency) can be done at any time.

No dependencies on other open changes (`project-dataset-query-model`, `use-case-connascence-reduction`, `use-case-package-refactor`).

## Trade-offs Considered

| Approach | Pros | Cons | Decision |
|----------|------|------|----------|
| Zod/Valibot runtime validation at LLM boundary | Full runtime + compile-time safety | New dependency, schema duplication with TS types | Deferred — manual validation sufficient for now |
| Rewrite filter system with OR support | Full RAQB fidelity | Large scope, TanStack Table limitations | Partial — add warning for OR, defer full rewrite |
| `satisfies` keyword everywhere | Better type inference | Requires TS 4.9+, churn across many files | Deferred — apply incrementally as files are touched |
| Replace all default exports with named | Consistent imports, better tree-shaking | Large diff, low value | Deferred — not worth the churn |
| **Phased internal refactoring** | Incremental, low risk, independently shippable | More PRs to review | **Selected** |
