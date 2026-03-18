# Tasks: Project → Dataset → Query Model

## Phase 1: Backend — Additive Changes (no breaking changes)

- [ ] 1.1 Add `include_transforms: bool = True` parameter to `MetadataRepository.list_datasets()` in `backend/app/repositories/metadata/repository.py`. When `False`, skip the `selectinload(DatasetRecord.transforms...)` option. When `True`, retain current behavior (eager load with soft-delete filter). Update the protocol/abstract method in `backend/app/repositories/metadata/__init__.py` to match.
- [ ] 1.2 Add `list_datasets_for_project` use case in `backend/app/use_cases/dataset/`. Use `@with_repositories` + `@handle_returns` decorator stack. Verify project exists and org access via `ProjectService.fetch_and_authorize_project()`. Call `repositories.metadata.list_datasets(project_id, include_transforms=False)`. Return sparse dicts (`{ id, name, link, description, schema_config }`).
- [ ] 1.3 Add `GET /api/projects/{project_id}/datasets` route in `backend/app/routers/projects.py`. Wire to a controller method that calls the `list_datasets_for_project` use case.
- [ ] 1.4 Write tests for the new endpoint: project with datasets returns sparse list, empty project returns `[]`, nonexistent project returns 404, wrong org returns 403.

## Phase 2: Backend — Remove Nesting and N+1

- [ ] 2.1 Remove the `include_datasets` parameter from the `get_project` use case (`backend/app/use_cases/project/get_project.py`). Remove it from `ProjectService.fetch_and_authorize_project()`. The use case always returns project metadata only.
- [ ] 2.2 Remove the `include_datasets` query parameter from the project router (`backend/app/routers/projects.py`). Remove it from the controller forwarding. The repository method `get_project()` should be called with `include_datasets=False` (or remove the parameter and stop loading datasets by default).
- [ ] 2.3 Update `MetadataRepository.get_project()` — change default to `include_datasets=False` or remove the parameter entirely. Remove the `selectinload(ProjectRecord.datasets)` path and the sparse dict construction block (lines 97-118 of `repository.py`). Update the protocol in `__init__.py`.
- [ ] 2.4 Remove `ProjectService.fetch_full_datasets()` from `backend/app/use_cases/project/project_service.py`. Update `export_dbt_project.py` to call `repositories.metadata.list_datasets(project_id, include_transforms=True)` directly, then convert via `Dataset.from_record(record, include_transforms=True)` for each record.
- [ ] 2.5 Remove the standalone `fetch_full_datasets()` function from `backend/app/use_cases/sql_access/sql_access_service.py`. Update `provision_and_bootstrap_environment()` to accept `metadata_repo` and `project_id` instead of `sparse_datasets` + `metadata_repo`, and call `metadata_repo.list_datasets(project_id, include_transforms=True)` + `Dataset.from_record()`.
- [ ] 2.6 Update `enable_sql_access.py`: remove import of `fetch_full_datasets`, replace the `fetch_full_datasets(sparse_datasets, metadata_repo)` call with `repositories.metadata.list_datasets(project_id, include_transforms=True)` + domain conversion. Remove the intermediate `sparse_datasets` variable if no longer needed.
- [ ] 2.7 Update `sync_sql_access.py`: same pattern as 2.6 — replace `fetch_full_datasets` with direct `list_datasets` + domain conversion.
- [ ] 2.8 Update `start_environment.py` and `restart_environment.py`: adjust calls to `provision_and_bootstrap_environment()` to pass `project_id` instead of `sparse_datasets`.
- [ ] 2.9 Remove the dead `include_transforms` parameter from the `get_dataset` use case in `backend/app/use_cases/dataset/get_dataset.py` (it's accepted but never used to control behavior).
- [ ] 2.10 Update backend tests: `test_get_project.py` assertions for flat response (no `datasets` field), `test_project_service.py` remove `TestFetchFullDatasets` class, SQL access test fixtures that mock `fetch_full_datasets`. Run `cd backend && uv run pytest` to verify.

## Phase 3: Frontend — Independent Query Layers

- [ ] 3.1 Extend `datasetKeys` in `frontend/src/lib/ui/hooks/useDatasetQuery.ts`: add `lists: () => [...datasetKeys.all, "list"] as const` and `list: (projectId: string) => [...datasetKeys.lists(), projectId] as const`.
- [ ] 3.2 Move `DatasetSparse` interface from `frontend/src/lib/api/projects.ts` to `frontend/src/lib/api/datasets.ts`. Update all imports across the frontend.
- [ ] 3.3 Add `listDatasetsForProject(projectId: string): Promise<DatasetSparse[]>` function in `frontend/src/lib/api/datasets.ts`. It calls `GET /api/projects/${projectId}/datasets`.
- [ ] 3.4 Add `useDatasets(projectId)` hook in `frontend/src/lib/ui/hooks/useDatasetQuery.ts`. Use `datasetKeys.list(projectId)`, call `listDatasetsForProject`, configure `staleTime: 10_000`, `placeholderData: keepPreviousData`, `enabled: Boolean(projectId)`.
- [ ] 3.5 Remove `datasets: DatasetSparse[]` from the `Project` interface in `frontend/src/lib/api/projects.ts`. This will surface all `project.datasets` usages as compile errors.
- [ ] 3.6 Update components that read `project.datasets` to use `useDatasets(projectId)` instead. The sidebar/dataset list component is the primary site. Handle the independent loading state.
- [ ] 3.7 Add `staleTime: 30_000` to `useProjectQuery` in `frontend/src/lib/ui/hooks/useProjectQuery.ts`.

## Phase 4: Frontend — Cleanup

- [ ] 4.1 Update `useRenameDataset` in `frontend/src/lib/ui/hooks/useDatasetMutations.ts`: remove optimistic update of `projectKeys.detail(projectId)` from `onMutate`, remove project rollback from `onError`, replace `projectKeys.detail(projectId)` invalidation in `onSettled` with `datasetKeys.list(projectId)`.
- [ ] 4.2 Remove `useUpdateProjectDatasetCache` hook from `frontend/src/lib/ui/hooks/useProjectQuery.ts`. Remove all call sites.
- [ ] 4.3 Remove `datasetToSparse` utility from `frontend/src/lib/api/datasets.ts`.
- [ ] 4.4 Update any other mutation hooks or tool call handlers that invalidate `projectKeys.detail()` for dataset-related changes — switch to `datasetKeys.list(projectId)` or `datasetKeys.all`.
- [ ] 4.5 Run `npm run build` to verify no TypeScript compilation errors. Run `npm run test` to verify no test regressions.

## Phase 5: Verification

- [ ] 5.1 Run full backend test suite: `cd backend && uv run pytest`.
- [ ] 5.2 Run full frontend test suite: `cd frontend && npx vitest run`.
- [ ] 5.3 Verify no remaining references to `project.datasets` or `project["datasets"]` in frontend code (grep check).
- [ ] 5.4 Verify no remaining references to `fetch_full_datasets` in backend code (grep check).
- [ ] 5.5 Verify no remaining `include_datasets` parameter in backend use cases, controllers, or routers (grep check).
- [ ] 5.6 Manual smoke test: select a project → datasets load in sidebar → select a dataset → transforms visible → rename a dataset → list refreshes → switch projects → previous data shows briefly then updates.
