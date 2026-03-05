# Capability: Frontend Query Decoupling

**Status**: MODIFIED
**Domain**: frontend (hooks, types, components, mutations)

## Overview

Decouple dataset fetching from the project query so that projects and datasets have independent TanStack Query cache entries. Replace the nested `project.datasets` access pattern with a dedicated `useDatasets(projectId)` hook, simplify mutation invalidation, and tune cache timing per resource type.

---

## MODIFIED Requirements

### Requirement: Independent Dataset List Hook

A new `useDatasets(projectId)` hook SHALL fetch datasets independently from the project query.

- The hook SHALL call `GET /api/projects/:id/datasets` and use `datasetKeys.list(projectId)` as the query key.
- The hook SHALL be enabled only when `projectId` is defined (same pattern as `useProjectQuery`).
- The hook SHALL configure `staleTime: 10_000` (10 seconds) — datasets change more frequently than projects.
- The hook SHALL configure `placeholderData: keepPreviousData` for smooth transitions when switching between projects.

#### Scenario: Fetch datasets on project selection

- **WHEN** a user selects a project
- **THEN** the hook SHALL fetch `GET /api/projects/:projectId/datasets`
- **THEN** the query SHALL be cached under `["datasets", "list", projectId]`

#### Scenario: Switch between projects shows cached data immediately

- **WHEN** a user switches from Project A to Project B and back to Project A within 10 seconds
- **THEN** Project A's dataset list SHALL render immediately from cache
- **THEN** a background revalidation SHALL occur if the data is stale

#### Scenario: Previous project data shown as placeholder

- **WHEN** a user switches from Project A to Project B for the first time
- **THEN** Project A's dataset list SHALL remain visible as placeholder data while Project B's list loads
- **THEN** the UI SHALL swap to Project B's data once the fetch completes

---

### Requirement: Query Key Factory Extension

The `datasetKeys` factory SHALL include a `list` key builder for project-scoped dataset lists.

- The factory SHALL be extended with: `lists: () => [...datasetKeys.all, "list"] as const` and `list: (projectId: string) => [...datasetKeys.lists(), projectId] as const`.
- The `all` and `detail` keys SHALL remain unchanged.
- Invalidating `datasetKeys.all` SHALL still invalidate both list and detail queries (TanStack Query's prefix matching).

#### Scenario: Dataset key hierarchy

- **WHEN** `queryClient.invalidateQueries({ queryKey: datasetKeys.all })` is called
- **THEN** all dataset queries SHALL be invalidated (lists and details)

- **WHEN** `queryClient.invalidateQueries({ queryKey: datasetKeys.lists() })` is called
- **THEN** all dataset list queries SHALL be invalidated
- **THEN** dataset detail queries SHALL NOT be invalidated

---

### Requirement: Project Type Without Nested Datasets

The `Project` type SHALL NOT include a `datasets` field. The `DatasetSparse` type SHALL move to the datasets module.

- The `Project` interface in `frontend/src/lib/api/projects.ts` SHALL remove the `datasets: DatasetSparse[]` field.
- The `DatasetSparse` interface SHALL move to `frontend/src/lib/api/datasets.ts` (it describes datasets, not projects).
- A new `listDatasetsForProject(projectId: string): Promise<DatasetSparse[]>` API function SHALL be added to `datasets.ts`.
- All imports of `DatasetSparse` SHALL update to the new location.

#### Scenario: Project response type matches new API shape

- **WHEN** TypeScript compiles the frontend
- **THEN** the `Project` type SHALL NOT have a `datasets` property
- **THEN** code accessing `project.datasets` SHALL produce a compile error

---

### Requirement: Remove Manual Project-Dataset Cache Manipulation

The `useUpdateProjectDatasetCache` hook SHALL be removed entirely. Components that used it SHALL use `useDatasets(projectId)` with standard invalidation instead.

- The `updateDatasetInProject` function SHALL be removed.
- The `addDatasetToProject` function SHALL be removed.
- The `datasetToSparse` utility in `datasets.ts` SHALL be removed (it existed to convert full datasets into the sparse format for project cache insertion).
- All call sites SHALL be updated to use `queryClient.invalidateQueries({ queryKey: datasetKeys.list(projectId) })` instead.

#### Scenario: Dataset rename invalidates dataset list

- **WHEN** a user renames a dataset
- **THEN** the mutation `onSettled` SHALL invalidate `datasetKeys.list(projectId)` and `datasetKeys.detail(datasetId)`
- **THEN** the mutation SHALL NOT touch `projectKeys.detail(projectId)`

---

### Requirement: Simplified Mutation Invalidation

Dataset mutations SHALL invalidate only dataset-scoped query keys, not project keys.

- `useRenameDataset` SHALL invalidate `datasetKeys.list(projectId)` and `datasetKeys.detail(datasetId)` on settle. It SHALL NOT invalidate `projectKeys.detail(projectId)`.
- Optimistic updates in `useRenameDataset.onMutate` SHALL update `datasetKeys.detail(datasetId)` only (not the project cache).
- Rollback in `useRenameDataset.onError` SHALL restore `datasetKeys.detail(datasetId)` only.
- Other dataset mutations (create, delete, toggle transform) SHALL follow the same pattern.
- Tool call cache invalidations in `executeToolCall.ts` SHALL continue invalidating `datasetKeys.detail(datasetId)` (unchanged).

#### Scenario: Rename dataset mutation lifecycle

- **WHEN** a rename mutation fires
- **THEN** `onMutate` SHALL optimistically update `datasetKeys.detail(datasetId)` with the new name
- **THEN** `onError` SHALL rollback `datasetKeys.detail(datasetId)` to the previous value
- **THEN** `onSettled` SHALL invalidate `datasetKeys.detail(datasetId)` and `datasetKeys.list(projectId)`
- **THEN** `projectKeys` SHALL NOT be touched at any stage

---

### Requirement: Component Migration

Components that read `project.datasets` SHALL switch to the `useDatasets(projectId)` hook.

- The dataset list/selector in the sidebar SHALL use `useDatasets(projectId)` instead of `useProjectQuery(projectId).data.datasets`.
- The component SHALL handle the loading state of the datasets query independently from the project query.
- The component SHALL handle the empty state (project with no datasets).

#### Scenario: Sidebar shows datasets from independent query

- **WHEN** a project is selected and datasets are loading
- **THEN** the sidebar SHALL show a loading state for the dataset list
- **THEN** the project metadata (name, description) SHALL already be rendered from the project query

#### Scenario: Sidebar shows empty dataset list

- **WHEN** a project with no datasets is selected
- **THEN** the sidebar SHALL render an empty dataset list (same as current behavior)
- **THEN** the project query SHALL NOT be affected

---

### Requirement: Cache Timing Per Resource Type

Query hooks SHALL configure `staleTime` appropriate to each resource type's change frequency.

- `useProjectQuery` SHALL set `staleTime: 30_000` (30 seconds) — projects change rarely (name/description edits).
- `useDatasets` SHALL set `staleTime: 10_000` (10 seconds) — datasets change moderately (uploads, deletes).
- `useDatasetQuery` SHALL keep the default `staleTime` from QueryProvider (5 minutes) — dataset detail is fetched on demand and transforms update via cache invalidation.
- The global `staleTime: 5 * 60 * 1000` in QueryProvider SHALL remain unchanged as the default.

#### Scenario: Project data stays fresh longer

- **WHEN** a project is fetched and the user navigates away and back within 30 seconds
- **THEN** the project SHALL render from cache without a background refetch

#### Scenario: Dataset list revalidates sooner

- **WHEN** the dataset list is fetched and the user navigates away and back after 15 seconds
- **THEN** the cached data SHALL render immediately
- **THEN** a background refetch SHALL occur (data is stale after 10 seconds)
