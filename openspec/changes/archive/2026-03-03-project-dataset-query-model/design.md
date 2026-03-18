# Design: Project → Dataset → Query Model

## Architecture Overview

This change decouples the Project and Dataset data loading across the full stack. The current nested pattern (project response embeds datasets, frontend reads `project.datasets`) is replaced with independent endpoints and independent TanStack Query cache entries.

```
BEFORE                                  AFTER
──────                                  ─────
GET /projects/:id                       GET /projects/:id
  → { ...project, datasets: [...] }      → { ...project }  (no datasets)

(no endpoint)                           GET /projects/:id/datasets
                                          → [ { id, name, ... }, ... ]

Frontend:                               Frontend:
  useProject(id).data.datasets            useDatasets(projectId).data
  ↕ coupled cache                         ↕ independent cache
  invalidate project + dataset keys       invalidate dataset keys only
```

---

## Decision 1: Add `include_transforms` to existing `list_datasets` rather than new method

### Current State

`MetadataRepository.list_datasets(project_id)` always loads transforms via `selectinload`. The N+1 `fetch_full_datasets` functions exist because callers needed domain objects, not ORM records — but the actual query is already efficient in `list_datasets`.

### Target State

Add `include_transforms: bool = True` parameter to `list_datasets()`. When `False`, skip the `selectinload`. The API endpoint calls with `False`; internal callers (SQL access, dbt export) call with `True`.

### Why Not a Separate Method

The query is identical except for the `selectinload` option. A separate method would duplicate the `WHERE`, `ORDER BY`, and soft-delete filter logic. The parameter follows the existing pattern on `get_dataset_record(include_transforms)`.

### N+1 Elimination

The existing `list_datasets` already executes a single query with `selectinload`. The N+1 exists because `fetch_full_datasets` doesn't use `list_datasets` — it loops through sparse dicts and calls `get_dataset_record` per dataset. The fix is to redirect callers to `list_datasets` + `Dataset.from_record()`.

```python
# Before (N+1)
sparse = project_dict["datasets"]
for ds in sparse:
    record = await repo.get_dataset_record(ds["id"])
    full.append(Dataset.from_record(record))

# After (single query)
records = await repo.list_datasets(project_id, include_transforms=True)
full = [Dataset.from_record(r, include_transforms=True) for r in records]
```

---

## Decision 2: New endpoint on project router, not dataset router

### Decision

Add `GET /api/projects/:id/datasets` on the project router, not a modification to `GET /api/datasets`.

### Rationale

- The URL hierarchy expresses ownership: datasets belong to a project.
- The existing `GET /api/datasets?project_id=...` endpoint returns full dataset objects with transforms — a different response shape. Overloading it with a sparse format would require a `format` or `sparse` query parameter, adding ambiguity.
- Auth scoping is naturally expressed: fetch the project first (verifies org access), then return its datasets.

### Alternative Considered

Modify `GET /api/datasets?project_id=...` to return sparse format. Rejected because it changes the existing contract and mixes two response shapes on one endpoint.

---

## Decision 3: Move `DatasetSparse` type to datasets module

### Current State

`DatasetSparse` is defined in `frontend/src/lib/api/projects.ts` because it's a property of the `Project` response. It's imported by `datasets.ts` for the `datasetToSparse` converter.

### Target State

Move `DatasetSparse` to `frontend/src/lib/api/datasets.ts`. The `Project` type loses its `datasets` field. The `datasetToSparse` utility is deleted (no longer needed — the API returns sparse format directly).

### Why

`DatasetSparse` describes a dataset, not a project. After this change, the project API module has no dataset-related types. The datasets module owns all dataset types and the new `listDatasetsForProject` function.

---

## Decision 4: Optimistic updates only on dataset detail, not dataset list

### Current State

`useRenameDataset` optimistically updates both the project cache (reaching into `project.datasets`) and the dataset detail cache.

### Target State

Optimistic updates target `datasetKeys.detail(datasetId)` only. The dataset list is invalidated on settle, triggering a background refetch.

### Why Not Optimistic Update on the List Too

The dataset list is sparse (no `name` in the current shape — wait, it does have `name`). Actually, we could optimistically update the list. But the list uses `keepPreviousData` and has a 10s `staleTime`, so the invalidation-driven refetch is nearly instant. The complexity of optimistically patching an array (find by id, merge) isn't worth it for a sub-second visible improvement. Keep it simple — invalidate the list, let SWR handle it.

---

## Decision 5: `staleTime` values

| Resource | staleTime | Rationale |
|----------|-----------|-----------|
| Projects | 30s | Name/description edits are rare. The list doesn't change often. |
| Dataset list | 10s | Uploads and deletes happen during active work sessions. |
| Dataset detail | 5min (global default) | Fetched on-demand when a dataset is selected. Transforms update via explicit invalidation after mutations. |

### Why Not Longer for Projects

Projects could arguably use a much longer `staleTime` (minutes). But since org-scoped access is verified on fetch, a shorter time keeps the access check reasonably current. 30s is a compromise between freshness and request volume.

### Why Not Shorter for Dataset List

10s means at most one background refetch per project view. Shorter times (e.g., 2s) would cause visible loading indicators on every project switch. The `keepPreviousData` placeholder smooths the UX regardless.

---

## Risks / Trade-offs

**[Two requests instead of one on project select]** → Previously, selecting a project made one request that returned project + datasets. Now it makes two (project metadata + dataset list). **Mitigation**: The requests are small (metadata is ~200 bytes, sparse list is ~1KB for 10 datasets). They run in parallel (both hooks activate on `projectId` change). The total latency is `max(project, datasets)`, not `sum`.

**[Frontend components must handle independent loading states]** → The project query and dataset list query may resolve at different times. **Mitigation**: This is standard TanStack Query usage. The sidebar can show project name immediately and a brief skeleton for the dataset list. The `keepPreviousData` placeholder means the dataset list almost never shows a loading state in practice (the previous project's data fills the gap).

**[Breaking change to `GET /projects/:id` response]** → Any external client that reads `project.datasets` from this endpoint will break. **Mitigation**: There are no external clients — the frontend is the only consumer. The frontend changes are deployed atomically with the backend. The new `GET /projects/:id/datasets` endpoint is available before the old response shape is removed (backend deploys first).

---

## Migration Plan

1. **Backend Phase 1**: Add `include_transforms` parameter to `list_datasets`. Add `GET /projects/:id/datasets` endpoint. Both changes are additive — nothing breaks.

2. **Backend Phase 2**: Remove `include_datasets` from `get_project` use case and router. Remove `fetch_full_datasets` from both services. Update SQL access / dbt export callers to use `list_datasets` directly. The old response shape disappears.

3. **Frontend Phase 3**: Add `useDatasets` hook, extend `datasetKeys`, add `listDatasetsForProject`. Move `DatasetSparse`, remove `datasets` from `Project` type. Update components and mutations.

4. **Cleanup Phase 4**: Remove `useUpdateProjectDatasetCache`, `datasetToSparse`, dead `include_transforms` param on `get_dataset` use case.

Phases 1-2 are backend-only commits. Phase 3 is frontend-only. Phase 4 is cleanup. Each phase is independently deployable.
