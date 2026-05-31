# Walking Skeleton — pipeline-layers-ui-redesign / MR-6

> Notes only. The scenario SSOT is the test suites: the backend pytest cases in
> `backend/tests/use_cases/dataset/test_update_dataset.py` and the frontend vitest
> files (`UploadModal.test.tsx`, `DisplayNameEditor.test.tsx`, the
> `useUpdateDatasetDisplayName` block in `useDatasetMutations.test.tsx`,
> `PipelineUploadReopen.test.tsx`, `TableView.displayName.test.tsx`). happy-dom is the
> FE medium (DWD-M6-2): assert structure / testids / rendered values / navigation,
> never computed colors or dial-up timing.

## Strategy
**C — real local I/O** (DWD-M6-1). Backend = the `update_dataset` use case over the real
seeded SQLite session (`seeded_db`) + the Alembic 014 round-trip. Frontend =
`cd frontend && npx vitest run` with the driven `uploadFile`/`updateDataset` clients doubled
at the dataCatalog boundary. NO separate `tests/acceptance/<feature>/` pytest suite (none
exists for this feature; mirrors MR-1..MR-5). The ONLY backend touch is the additive
nullable `display_name` column — NO new endpoint/table (DWD-M6-3).

## The thin slice (`@walking_skeleton`)
`UploadModal.test > "@walking_skeleton uploads a file, edits the display name, and creates
a source — display_name persisted, filename/name unchanged"`:
a real file pick → the in-flight `uploadFile("/api/uploads", file, { project_id })` promise
(doubled) → the parsed schema view from the returned dataset's `schema_config` → an edited
display name saved via the real `useUpdateDatasetDisplayName` mutation (doubled
`updateDataset` asserted called with ONLY `{ display_name }`) → "create source" closes the
modal and hands the created dataset to the host (the source node). This proves the
load-bearing MR-6 premise end-to-end: a standalone upload produces a source whose editable
display name persists while its filename/`name` is never mutated, ready to appear as a
lineage node — all without touching the ui-state wire or adding any backend endpoint.

## Driving port
- **Frontend (FE analog):** the rendered modal/landing surface via
  `@testing-library/react` + `createRoutesStub`/`MemoryRouter`. There is no CLI/HTTP/hook
  entry point in the FE; the user's actual invocation path is opening the modal from the
  Pipeline toolbar (or by activating a source node), picking a file, and creating the source.
- **Backend:** the `update_dataset` use case (the same port `PATCH /api/datasets/{id}`
  wires) invoked with `set_session(seeded_db)` + `set_auth_user`.

## Scenario inventory (MR-6)
**Backend pytest (2 new)** — `test_update_dataset_when_display_name_provided_persists`
(updates `display_name`, asserts it round-trips AND `name`/filename unchanged) ·
`test_update_dataset_display_name_does_not_overwrite_name` (sending only `display_name`
leaves `name` intact). _(plus the migration round-trip, verified in DELIVER.)_
**Frontend vitest:**
- `DisplayNameEditor.test.tsx` — input defaults to `name` when `display_name` is null
  (fallback); shows `display_name` when set; save fires the mutation with ONLY
  `{ datasetId, displayName }`; the raw `name` is never sent.
- `useDatasetMutations.test.tsx` (+`useUpdateDatasetDisplayName` block) — optimistic
  `display_name` update to detail + list caches; rollback on error; invalidate on settle;
  `updateDataset` called with `{ display_name }`.
- `UploadModal.test.tsx` — closed renders nothing; open shows the dialog (browse/drop);
  picking a file + uploading shows the cosmetic 3-leg dial-up progress (`upload-progress`
  + 3 `upload-leg-*`) while the upload is in flight; on resolve the schema view renders the
  fields from `schema_config`; the editable display name persists via the mutation;
  "upload another to same schema" re-uploads with `{ project_id, dataset_id }` (same schema);
  "create source" hands off + closes; Esc/overlay/close-button close the modal; an upload
  error shows a retry; the per-source file-history renders the documented empty-state
  (`upload-history-empty`, deferred c); plus the `@walking_skeleton` happy path.
- `PipelineUploadReopen.test.tsx` — the Pipeline toolbar's upload button opens a fresh
  modal; activating a source (dataset) node reopens the modal in `existingSource` mode.
- `TableView.displayName.test.tsx` — the dataset-detail surface mounts the
  `DisplayNameEditor` with the correct initial value (`display_name ?? name`).

## What the doubles CANNOT model
- happy-dom does not apply the token stylesheet → no Neobrutalist/Solarized contrast,
  glass, or dial-up-frame assertions (MR-8 Playwright pass).
- The doubled `uploadFile`/`updateDataset` do not model real network latency or HTTP
  errors beyond a thrown rejection (covered by the existing dataCatalog REST contract tests).
- **Per-source upload history** (file list: names + rows + when) is NOT served by the API
  today (no list-uploads endpoint) — the modal renders a documented empty-state; a queryable
  history feed is a deferred (c), `upstream-issues.md` UI-7. No backend endpoint invented here.
- The cosmetic 3-leg dial-up progress is NOT a real streaming-upload signal — it animates
  around the existing single-step `uploadFile` promise (DWD-M6-5).
