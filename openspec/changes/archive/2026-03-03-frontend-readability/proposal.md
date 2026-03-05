## Why

Frontend TypeScript has accumulated conditional logic patterns that are difficult to scan — nested ternaries, deeply nested control flow, long boolean expressions, and repeated JSX guards. Separately, only ~28% of exported functions and components have JSDoc documentation, with entire directories (hooks, components, context, table-tools, auth) at 0% coverage. Both issues slow down developers reading unfamiliar code and increase the risk of misunderstanding behavior during maintenance.

## What Changes

### Conditional Logic Simplification

- **Extract named predicates**: Replace inline boolean expressions (e.g., `transform.status === "enabled" && (transform.transform_type ?? "filter") === "filter" && transform.condition_json`) with descriptively-named constants or functions.
- **Replace className ternary chains**: Convert multi-ternary className concatenation (e.g., `DatasetView/index.tsx:431`) to use `clsx` or a helper function with a state-to-class map.
- **Flatten nested control flow**: Refactor deeply nested if/try/if patterns (e.g., `ChatContext.tsx` token refresh at lines 145-199) into flat early-return sequences.
- **Consolidate repeated JSX guards**: Merge repeated `viewMode === "table" &&` blocks (e.g., `DatasetView/index.tsx:407-443`) into single conditional wrappers.
- **Replace validation switch with schema map**: Convert the 59-line `validateToolCallArgs` switch in `executeToolCall.ts` to a declarative validator map.

### JSDoc Documentation

- **Add JSDoc to all exported hooks**: `useTableConfig`, `useTransforms`, `useProjectQuery`, `useDatasetQuery`, `useOrgQuery`, `useSqlAccessQuery`, `useDatasetMutations`.
- **Add JSDoc to context providers**: `ChatContext` (SSE streaming, tool execution), `AuthContext` (token lifecycle, dev/WorkOS modes).
- **Add JSDoc to table-tools exports**: `executeToolCall`, `customFilterFn`, `ToolCallArgs` discriminated union, `ToolCallHandlers`, `TransformInfo`.
- **Add JSDoc to component props and exported components**: Focus on components with complex props interfaces — `ChatPanel`, `TablePanel`, `DatasetView`, `SideNav`, `SqlAccessPanel`.
- **Convert informative inline comments to JSDoc**: Where existing `//` comments describe a function's purpose, promote them to `/** */` on the function signature.

## Capabilities

### New Capabilities

- `conditional-logic-standards`: Patterns and rules for readable conditional logic in frontend TypeScript — named predicates, className helpers, early returns, JSX guard consolidation, declarative validation.
- `jsdoc-coverage-standards`: JSDoc documentation requirements for exported frontend APIs — hooks, context providers, components, utility functions, and type definitions.

### Modified Capabilities

_(none — this is a readability refactor with no behavior changes)_

## Impact

- **Frontend files modified (~25-30)**: Components, hooks, context, and table-tools across `frontend/src/lib/`.
- **New dependency**: `clsx` (lightweight className utility, 228 bytes gzipped) — or use an inline helper to avoid the dependency.
- **No API changes**: All changes are internal readability improvements.
- **No behavior changes**: Conditional logic produces identical results; JSDoc adds documentation only.
- **No backend/worker/shared changes**: Entirely scoped to `frontend/src/lib/`.
- **Risk**: LOW. Each file can be refactored independently. Tests validate behavior is preserved.
