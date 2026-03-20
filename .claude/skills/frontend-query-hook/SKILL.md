---
name: frontend-query-hook
description: Use when creating or modifying TanStack Query hooks, mutations, or related tests in the frontend. Covers key factory patterns, stale times, optimistic mutation structure, path aliases, and QueryClientProvider test wrapper setup.
---

# Frontend Query Hook Pattern

## Overview

All server state is managed through TanStack Query. Query keys, stale times, and mutation rollback follow project-specific conventions — always extend existing patterns rather than introducing ad-hoc alternatives.

## Key Factories

Defined in `frontend/src/lib/queryKeys.ts`. Always add new domains here — **never hardcode query key strings inline**.

```typescript
export const myKeys = {
  all: ["my-domain"] as const,
  lists: () => [...myKeys.all, "list"] as const,
  list: (scopeId: string) => [...myKeys.lists(), scopeId] as const,
  details: () => [...myKeys.all, "detail"] as const,
  detail: (id: string) => [...myKeys.details(), id] as const,
};
```

Keys are hierarchical — invalidating `myKeys.all` invalidates all lists and details for that domain.

## Query Hooks

```typescript
export function useMyThing(id: string) {
  return useQuery({
    queryKey: myKeys.detail(id),
    queryFn: () => api.getMyThing(id),
    enabled: Boolean(id),                    // skip if id is empty/undefined
    staleTime: QUERY_STALE_TIMES.MY_THING,   // from queryConfig.ts
  });
}

export function useMyThingList(scopeId: string) {
  return useQuery({
    queryKey: myKeys.list(scopeId),
    queryFn: () => api.listMyThings(scopeId),
    enabled: Boolean(scopeId),
    keepPreviousData: true,                  // smooth pagination/filter UX
    staleTime: QUERY_STALE_TIMES.MY_THING_LIST,
  });
}
```

## Stale Times

Add new entries to `QUERY_STALE_TIMES` in `frontend/src/ui/hooks/queryConfig.ts`:

```typescript
export const QUERY_STALE_TIMES = {
  DATASET_LIST: 10_000,     // 10s for lists
  DATASET_DETAIL: 300_000,  // 5min for details
  MY_THING_LIST: 10_000,    // lists: short TTL
  MY_THING: 300_000,        // details: long TTL
};
```

**Never** pass a raw number to `staleTime` — always use the named constant.

## Mutation Pattern

Follow this exact structure for all mutations with optimistic updates:

```typescript
export function useUpdateMyThing(scopeId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateThingInput) => api.updateMyThing(data),

    onMutate: async (data) => {
      // 1. Cancel in-flight refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: myKeys.detail(data.id) });
      await queryClient.cancelQueries({ queryKey: myKeys.list(scopeId) });

      // 2. Snapshot current cache for rollback
      const previousDetail = queryClient.getQueryData(myKeys.detail(data.id));
      const previousList = queryClient.getQueryData(myKeys.list(scopeId));

      // 3. Apply optimistic update
      queryClient.setQueryData(myKeys.detail(data.id), (old: MyThing) => ({
        ...old,
        ...data,
      }));

      return { previousDetail, previousList };
    },

    onError: (_err, data, context) => {
      // Restore snapshots on failure
      queryClient.setQueryData(myKeys.detail(data.id), context?.previousDetail);
      queryClient.setQueryData(myKeys.list(scopeId), context?.previousList);
    },

    onSettled: (_data, _err, data) => {
      // Always invalidate after success or failure to sync with server
      queryClient.invalidateQueries({ queryKey: myKeys.detail(data.id), exact: true });
      queryClient.invalidateQueries({ queryKey: myKeys.list(scopeId), exact: true });
    },
  });
}
```

## Path Aliases

Configured in `vite.config.ts` — use these instead of relative paths:

| Alias | Maps to |
|-------|---------|
| `@/table-tools` | `src/lib/table-tools/` |
| `@/chat` | `src/lib/chat/` |
| `@/raqb` | `src/lib/raqb/` |
| `@/api` | `src/lib/api/` |
| `@/auth` | `src/lib/auth/` |

## Testing Hooks

**Always create a new QueryClient per test** to avoid state contamination between tests.

```typescript
describe("useMyThing", () => {
  let queryClient: QueryClient;

  function createWrapper() {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    return ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  it("returns thing data", async () => {
    // Pre-seed cache to avoid network calls
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(myKeys.detail("id-1"), { id: "id-1", name: "Test" });

    const { result } = renderHook(() => useMyThing("id-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.name).toBe("Test");
  });

  it("optimistic update rolls back on error", async () => {
    server.use(http.put("/api/things/:id", () => HttpResponse.error()));

    const { result } = renderHook(() => useUpdateMyThing("scope-1"), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ id: "id-1", name: "Optimistic" });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    // Cache should be restored
    const cached = queryClient.getQueryData(myKeys.detail("id-1"));
    expect(cached).toEqual(original);
  });
});
```

**Key testing patterns:**
- `renderHook(..., { wrapper: createWrapper() })` — always required for hooks using TanStack Query
- `queryClient.setQueryData(key, data)` — pre-seed cache to avoid real network calls
- `queryClient.getQueryData(key)` — assert cache state directly
- `waitFor()` — wrap all async assertions

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Hardcoded key string `["my-domain", "list"]` | Add to `queryKeys.ts` key factory |
| Raw `staleTime: 30000` | Add constant to `queryConfig.ts`, use by name |
| Missing `enabled: Boolean(id)` on dependent query | Always guard with `enabled` |
| Shared QueryClient across tests | Create new `QueryClient` in each test's `createWrapper()` |
| No `QueryClientProvider` in test render | Use `wrapper: createWrapper()` in `renderHook` |
| `onSettled` without `exact: true` | Use `exact: true` to avoid over-invalidation |
| Skipping `cancelQueries` in `onMutate` | Always cancel before optimistic update |

## Reference Files

- `frontend/src/lib/queryKeys.ts` — key factories (add new domains here)
- `frontend/src/ui/hooks/queryConfig.ts` — stale times
- `frontend/src/ui/hooks/useDatasetQuery.ts` — query hook example
- `frontend/src/ui/hooks/useDatasetMutations.ts` — mutation with optimistic updates
- `frontend/src/ui/hooks/__tests__/useDatasetMutations.test.tsx` — test pattern
