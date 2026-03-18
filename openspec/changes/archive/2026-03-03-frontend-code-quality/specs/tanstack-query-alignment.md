# Capability: TanStack Query Alignment

**Status**: MODIFIED
**Domain**: frontend (hooks, mutations, providers)

## Overview

Align query hooks with idiomatic TanStack Query v5 patterns: explicit error typing, proper mutation lifecycle, safe query key construction, standardized cache timing, and precise invalidation.

---

## MODIFIED Requirements

### Requirement: Explicit Error Types on Query Hooks

All query hooks SHALL declare `ApiError` as their error type generic parameter.

- `useDatasetQuery`, `useProjectQuery`, `useOrgProjectsQuery`, `useSqlAccessQuery`, and `useEnvironmentStatus` SHALL use `useQuery<TData, ApiError>`.
- Mutation hooks SHALL use `useMutation<TData, ApiError, TVariables>`.

#### Scenario: Consumer accesses typed error

- **WHEN** a query hook returns an error
- **THEN** the error SHALL be typed as `ApiError` with `.status` and `.message` properties
- **THEN** consumers SHALL have IDE autocompletion for error fields

---

### Requirement: Proper Mutation Lifecycle for useTransforms

Transform operations in `useTransforms.ts` SHALL use `useMutation` with `onMutate`/`onError`/`onSettled` callbacks instead of manual `queryClient.setQueryData()`.

- `saveTransform` SHALL be a `useMutation` that optimistically updates the dataset cache in `onMutate`.
- `onError` SHALL roll back the dataset cache to its pre-mutation state.
- `onSettled` SHALL invalidate the dataset detail query.
- The `onDatasetChange` callback pattern SHALL be removed.

#### Scenario: Transform save fails and rolls back

- **WHEN** a transform save API call fails after optimistic update
- **THEN** the dataset cache SHALL be rolled back to its previous state
- **THEN** the UI SHALL reflect the rollback

#### Scenario: Transform save succeeds

- **WHEN** a transform save API call succeeds
- **THEN** the optimistic update SHALL remain in cache
- **THEN** `onSettled` SHALL invalidate the query to sync with server state

---

### Requirement: Safe Query Key Construction

Query hooks SHALL NOT use non-null assertions (`!`) on potentially undefined ID parameters in query keys.

- Hooks receiving `string | undefined` parameters SHALL use conditional key construction or `skipToken`.
- Query keys SHALL never contain `undefined` values that create dead cache entries.

#### Scenario: Hook called with undefined projectId

- **WHEN** `useDatasets(undefined)` is called
- **THEN** the query SHALL be disabled
- **THEN** no cache entry with `undefined` in the key SHALL be created

---

### Requirement: Standardized staleTime Configuration

Query hooks SHALL use staleTime values from a shared configuration object.

- A `QUERY_STALE_TIMES` constant SHALL define named staleTime values for each resource type.
- All query hooks SHALL reference this constant instead of inline numbers.
- The values SHALL be documented with rationale.

#### Scenario: staleTime values are consistent

- **WHEN** a developer checks the staleTime for project queries
- **THEN** there SHALL be a single source of truth in `QUERY_STALE_TIMES`
- **THEN** every hook using project queries SHALL reference the same value

---

### Requirement: Precise Cache Invalidation

Cache invalidation calls SHALL use `exact: true` when targeting specific entries.

- Invalidation of `datasetKeys.detail(id)` SHALL use `{ exact: true }`.
- Invalidation of `datasetKeys.list(projectId)` SHALL use `{ exact: true }`.
- Family-level invalidation (`datasetKeys.all`) SHALL NOT use `exact: true` (prefix matching is intentional).

#### Scenario: Dataset detail invalidation is scoped

- **WHEN** a dataset mutation invalidates the detail cache
- **THEN** only the specific dataset's cache entry SHALL be invalidated
- **THEN** other dataset detail entries SHALL NOT be affected
