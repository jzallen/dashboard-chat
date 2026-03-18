# Design: Frontend Code Quality

## Architecture Overview

This change is a pure frontend refactoring — no API contracts, backend code, or database schema are modified. The changes span five areas across the frontend data layer, component tree, and utility modules.

```
BEFORE                                    AFTER
──────                                    ─────
LLM → Record<string, unknown> → as cast   LLM → validate() → ToolCallArgs union
Filter values: opaque objects              Filter values: discriminated union
useTransforms: manual setQueryData()       useTransforms: useMutation lifecycle
Query hooks: no error type                 Query hooks: useQuery<T, ApiError>
escapeIdentifier: strip chars              escapeIdentifier: quote properly
Catch blocks: ad-hoc patterns              Catch blocks: getErrorMessage()
```

---

## Decision 1: Runtime Validation at Tool Call Boundary (not Zod)

### Decision

Add hand-written validation functions in `executeToolCall.ts` that check required fields and return typed objects. Do not introduce Zod or Valibot.

### Rationale

The validation surface is small — roughly 8 tool call shapes. Each needs 2-4 field checks. A schema library adds a dependency, a second type definition layer, and import overhead for a problem that's solved with 30 lines of plain TypeScript.

### Implementation

```typescript
// table-tools/types.ts
export type ToolCallArgs =
  | { tool: "filterTable"; column: string; operator: string; value: unknown }
  | { tool: "sortTable"; column: string; direction: "asc" | "desc" }
  | { tool: "addRow"; data: Record<string, unknown> }
  | { tool: "deleteRows"; rowIndices: number[] }
  | { tool: "searchTable"; query: string }
  | { tool: "resetFilters" }
  | { tool: "resetSort" }
  | { tool: "activateCleaningTool"; operation: string; column: string; config?: Record<string, unknown> }

// table-tools/executeToolCall.ts
function validateArgs(name: string, raw: Record<string, unknown>): ToolCallArgs {
  switch (name) {
    case "filterTable":
      if (typeof raw.column !== "string") throw new Error("filterTable: missing column");
      if (typeof raw.operator !== "string") throw new Error("filterTable: missing operator");
      if (raw.value === undefined) throw new Error("filterTable: missing value");
      return { tool: "filterTable", column: raw.column, operator: raw.operator, value: raw.value };
    // ... other cases
  }
}
```

### Alternative Considered

Zod schemas with `.parse()`. Provides better error messages and auto-inference. Rejected — adds ~50KB dependency for 8 validation points. Can revisit if tool count grows significantly.

---

## Decision 2: Extend TanStackFilterValue as Discriminated Union (not separate type)

### Decision

Change `TanStackFilterValue` from a single shape to a union with a type guard function:

```typescript
export type TanStackFilterValue =
  | { operator: TanStackOperator; value: unknown; transformId?: string }
  | { conditions: Array<{ operator: string; value: unknown; transformId?: string }> }

export function isCompoundFilter(v: TanStackFilterValue): v is Extract<TanStackFilterValue, { conditions: unknown }> {
  return "conditions" in v;
}
```

### Rationale

The compound form already exists at runtime — `executeToolCall.ts` creates `{ conditions: [...] }` objects when merging multiple filters on the same column. The double assertion `as unknown as TanStackFilterValue` exists precisely because the type doesn't reflect this reality. Extending the union formalizes what's already happening.

### Why Not a Discriminant Field

Adding `type: "single" | "compound"` would require updating every place that creates filter values. The structural discriminant (`"conditions" in v`) is sufficient and requires no changes to creation sites.

---

## Decision 3: useMutation for Transforms (not useCallback + manual setQueryData)

### Decision

Convert the transform save/toggle/delete operations in `useTransforms.ts` to return `useMutation` hooks with proper lifecycle callbacks.

### Current State

`useTransforms` accepts an `onDatasetChange` callback and manually calls `queryClient.setQueryData()` inside `useCallback` functions. No rollback on failure. No cleanup on unmount.

### Target State

```typescript
export function useSaveTransform(datasetId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: TransformCreate) => createTransform(datasetId, data),
    onMutate: async (newTransform) => {
      await queryClient.cancelQueries({ queryKey: datasetKeys.detail(datasetId) });
      const previous = queryClient.getQueryData<Dataset>(datasetKeys.detail(datasetId));
      queryClient.setQueryData<Dataset>(datasetKeys.detail(datasetId), (old) => ({
        ...old!,
        transforms: [...(old?.transforms ?? []), { ...newTransform, id: "optimistic" }],
      }));
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(datasetKeys.detail(datasetId), context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: datasetKeys.detail(datasetId), exact: true });
    },
  });
}
```

### Why This Matters

The current pattern has three risks: (1) no rollback on API failure — optimistic state persists even when the server rejects the change; (2) no `cancelQueries` — concurrent mutations can interleave; (3) the `onDatasetChange` callback creates tight coupling between `DatasetView` and `useTransforms`. The `useMutation` pattern is the standard TanStack Query solution to all three.

---

## Decision 4: Synchronous refreshPromise Cleanup (not timer)

### Decision

Clear `refreshPromise = null` immediately in `.finally()`, removing the 500ms `setTimeout`.

### Current State

```typescript
refreshPromise = doRefresh().finally(() => {
  setTimeout(() => { refreshPromise = null; }, 500);
});
```

The 500ms delay was presumably intended to coalesce rapid-fire 401s into a single refresh. But the coalescing already works via the `if (refreshPromise) return refreshPromise` check — any call arriving while the refresh is in-flight shares the same promise. The 500ms window after settlement is unnecessary and creates a race where a new request in that window gets the stale (settled) promise.

### Target State

```typescript
refreshPromise = doRefresh().finally(() => {
  refreshPromise = null;
});
```

---

## Decision 5: Warning Return Value for OR Groups (not throw, not silent)

### Decision

Modify `raqbToTanstack` to return `{ filters, warnings }` instead of just `filters`. OR groups produce a warning string; callers decide whether to display it.

### Why Not Throw

Throwing would break the filter pipeline. The flattened filters still provide partial value (they just over-filter). A warning lets the UI surface the limitation without blocking the operation.

### Why Not Extend customFilterFn for OR Support

TanStack Table's `columnFilters` model is inherently AND-based. Supporting OR would require either a global filter (not per-column) or a custom filter model that wraps TanStack's. Both are significant scope. The warning is the right balance for this change — it surfaces the problem without solving it.

---

## Decision 6: Shared Error Utility (not try-catch wrapper)

### Decision

Create a standalone `getErrorMessage(error: unknown): string` function in `lib/errors.ts`.

### Why Not a Try-Catch Wrapper

A wrapper like `tryCatch(fn)` changes control flow and makes stack traces harder to read. The inconsistency is just in message extraction — some catch blocks use `instanceof Error`, some use `String(e)`. A simple extraction function standardizes the pattern without changing control flow.

```typescript
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}
```

---

## Risks / Trade-offs

**[Type union changes may surface existing bugs]** → Changing `TanStackFilterValue` to a union will cause compile errors anywhere the type is used without narrowing. This is the point — the compiler reveals places where the code assumes a single shape. But it means the diff may be larger than expected if many sites need narrowing guards. **Mitigation**: The `isCompoundFilter` type guard makes narrowing a one-liner.

**[useTransforms refactor changes component API]** → Components that currently pass `onDatasetChange` to `useTransforms` will need to switch to calling mutation hooks directly. This changes the hook's interface. **Mitigation**: Only `DatasetView/index.tsx` uses `useTransforms`. The refactor is localized.

**[escapeIdentifier quoting may affect downstream SQL]** → DuckDB (which executes the generated SQL) handles double-quoted identifiers. But if any column names contain actual double quotes, the escaped SQL must be correct. **Mitigation**: Column names come from the schema (user-defined CSV headers). The double-doubling escape is standard SQL and DuckDB-compatible.

**[Query key changes may bust existing cache entries]** → If the key construction for disabled queries changes (e.g., from `["datasets", "list", undefined]` to using `skipToken`), existing cache entries become orphaned. **Mitigation**: No persistence — cache is in-memory only and cleared on page refresh. No user-visible impact.

---

## Migration Plan

All five phases are independently deployable as separate PRs:

1. **Phase 1 — Type safety**: Change types, add validation. Pure refactor, no behavior change. Compiler verifies correctness.
2. **Phase 2 — TanStack Query**: Convert hooks. Behavior improves (rollback, error types). Tests verify.
3. **Phase 3 — RAQB correctness**: Fix escaping, add warnings, add tests. Behavior changes (correct SQL).
4. **Phase 4 — React patterns**: Fix effects, closures, timers, a11y. Mixed behavior/perf improvements.
5. **Phase 5 — Consistency**: Error utility, config, styling. Pure cleanup.

Each phase can be reviewed and merged independently. No phase depends on another. Phase 1 is recommended first because it establishes types that make Phases 2-4 easier to implement.
