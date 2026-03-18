## Why

The Project → Dataset → Transform hierarchy is loaded inefficiently across both services. Three problems compound:

1. **Over-fetching on the API path.** `GET /api/projects/:id` always returns nested datasets (via `include_datasets=True` in the controller), but the frontend only needs them when rendering the dataset list — not when rendering project metadata. The repository eagerly loads transforms via `selectinload` even though `to_sparse_dict()` discards them.

2. **N+1 duplication.** Two identical `fetch_full_datasets` methods (ProjectService and SqlAccessService) fetch all datasets for a project, then re-fetch each one individually to get transforms. This is both an N+1 query pattern and literal code duplication.

3. **Coupled cache invalidation.** Because datasets are nested inside the project response, the frontend must double-invalidate both `projectKeys.detail(id)` and `datasetKeys.all` on every dataset mutation. There's no `useDatasets(projectId)` hook — datasets are read from `useProject(id).data.datasets`, coupling two independent concerns.

## What Changes

### Backend: Flatten the API, consolidate internal loading

- **New endpoint**: `GET /api/projects/:id/datasets` — returns datasets for a project (sparse, no transforms). Backed by a new `list_datasets` use case.
- **Simplify `get_project`**: Remove the `include_datasets` parameter. The project endpoint returns project metadata only.
- **New repository method**: `MetadataRepository.get_datasets_for_project(project_id, include_transforms=False)` with an opt-in flag. The API path calls it without transforms; SQL access use cases call it with transforms.
- **Eliminate `fetch_full_datasets`**: Both copies (ProjectService, SqlAccessService) are replaced by the repository method. The N+1 loop disappears — a single query with conditional `selectinload` replaces the fetch-then-re-fetch pattern.
- **Remove dead code**: The `include_transforms` parameter on `get_dataset` use case is unused — remove it.

### Frontend: Independent query layers with stale-while-revalidate

- **New `useDatasets(projectId)` hook**: Calls `GET /api/projects/:id/datasets` with `datasetKeys.list(projectId)`. Enabled when a project is selected.
- **Decouple from project response**: Components that read `project.datasets` switch to `useDatasets(projectId)`. The `ProjectWithDatasets` type is removed.
- **Cache tuning**: Configure `staleTime` per resource type — projects change rarely (30s), datasets change moderately (10s), dataset detail/transforms use defaults. Add `placeholderData: keepPreviousData` on `useDatasets` for smooth project-switching.
- **Simplify mutation invalidation**: Dataset mutations invalidate `datasetKeys.list(projectId)` only — no longer need to touch project keys.

## What Does NOT Change

- **Database schema** — no model or migration changes. This is purely about how data is loaded and returned.
- **SSE/chat paths** — the worker and shared chat handler don't depend on nested response shapes.
- **Auth or multi-tenancy** — org_id scoping is unaffected.
- **Transform endpoints** — transforms remain part of the dataset detail response (`GET /api/datasets/:id`). No separate transform endpoint or key factory needed at this stage.

## Sequencing

This change should be implemented **after** the `use-case-connascence-reduction` change is archived. That change explicitly defers `fetch_full_datasets` to this work (see its proposal, line 27) and introduces typed `RepositoryContainer` property accessors that this change will use.

## Scope

- **Backend**: ~13 files modified (controllers, use cases, repository, routers, service classes)
- **Frontend**: ~5 files modified (hooks, types, components using `project.datasets`)
- **Tests**: ~10-15 test files updated (response shape assertions, mock data, invalidation checks)
- **Risk**: No high-risk items. No schema changes, no SSE impact, no auth changes. All internal backend callers of `fetch_full_datasets` migrate to a single repository method.

## Trade-offs Considered

| Approach | Pros | Cons | Decision |
|----------|------|------|----------|
| Keep nested responses, fix N+1 only | Smaller change, backend-only | Frontend stays coupled, cache invalidation stays complex | Rejected — doesn't solve the root coupling |
| Separate transform endpoint | Full normalization of the hierarchy | Over-engineering for current scale; transforms are small and always needed with dataset detail | Deferred — can add later if transform lists grow |
| GraphQL for flexible loading | Client-driven field selection | Massive infrastructure change for a three-entity hierarchy | Rejected — wrong scale |
| **Flat REST endpoints + frontend query layers** | Clean separation, independent caching, eliminates N+1 and duplication | More frontend hooks, migration effort | **Selected** — best balance of simplicity and correctness |
