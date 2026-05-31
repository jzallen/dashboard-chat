# Walking Skeleton — pipeline-layers-ui-redesign / MR-7

> Notes only. The scenario SSOT is the test suites: the backend pytest cases in
> `backend/tests/use_cases/dataset/{test_archive_dataset,test_restore_dataset,
> test_list_datasets,test_list_datasets_for_project}.py` and the frontend vitest files
> (`core/coldStorage/__tests__/daysLeft.test.ts`, the `useArchiveDataset`/
> `useRestoreDataset` blocks in `useDatasetMutations.test.tsx`,
> `ui/components/ColdStorage/ColdStorageDrawer.test.tsx`,
> `ui/components/Pipeline/PipelineColdStorage.test.tsx`,
> `ui/components/UploadModal/UploadModalArchive.test.tsx`). happy-dom is the FE medium
> (DWD-M7-2): assert structure / testids / rendered values / navigation, never computed
> colors or the snowflake/fridge glyph styling.

## Strategy
**C — real local I/O** (DWD-M7-1). Backend = the `archive_dataset` / `restore_dataset`
use cases + the `list_datasets` archived filter over the real seeded SQLite session
(`seeded_db`) + the Alembic 015 round-trip. Frontend = `cd frontend && npx vitest run`
with the driven `archiveDataset` / `restoreDataset` / `listDatasetsForProject` clients
doubled at the dataCatalog boundary. NO separate `tests/acceptance/<feature>/` pytest
suite (none exists for this feature; mirrors MR-1..MR-6). The backend touch is TWO
additive nullable columns + 2 thin endpoints + 1 migration + list filtering — NO new
table (DWD-M7-3).

## The thin slice (`@walking_skeleton`)
`PipelineColdStorage.test > "@walking_skeleton archiving a source removes it from the live
lineage and orphans its downstream; restoring brings it back"`:
a project with a source dataset → a downstream view referencing it → the user archives the
source (snowflake → confirm) → the source LEAVES the live graph (its node is absent) and
the downstream view renders orphaned (`aria-disabled`) → the fridge drawer lists the
archived source with a days-left count → restore returns it to the live graph and re-links
the downstream. Backed by `test_archive_dataset` (archive sets `archived_at` and
`retention_until = archived_at + 90d`) + `test_restore_dataset` (both cleared). This proves
the load-bearing MR-7 premise end-to-end: archive state persists, drives the lineage via the
EXISTING `buildGraph` archived seam (fed the real set, not `new Set()`), and reverses on
restore — all without touching the ui-state wire or adding a new table.

## Driving port
- **Frontend (FE analog):** the rendered Pipeline landing / cold-storage drawer / upload
  modal via `@testing-library/react` + `createRoutesStub`/`MemoryRouter`. There is no
  CLI/HTTP/hook entry point in the FE; the user's actual invocation path is archiving a
  source from the per-source surface and restoring it from the fridge.
- **Backend:** the `archive_dataset` / `restore_dataset` / `list_datasets` use cases (the
  same ports `POST /api/datasets/{id}/archive`, `/restore`, and `GET /api/datasets?archived=`
  wire) invoked with `set_session(seeded_db)` + `set_auth_user`.

## Scenario inventory (MR-7)
**Backend pytest:**
- `test_archive_dataset.py` (new) — archive sets `archived_at` (now) AND
  `retention_until = archived_at + 90d`; archiving a missing dataset returns `Failure`
  (`DatasetNotFound`); a DB error returns `Failure`.
- `test_restore_dataset.py` (new) — restore clears `archived_at` AND `retention_until`
  (both `None`); restoring a missing dataset returns `Failure`.
- `test_list_datasets.py` (extend) — with one archived + one live dataset: the default
  list EXCLUDES the archived row; `archived=True` returns ONLY the archived row.
- `test_list_datasets_for_project.py` (extend) — same default-exclude + archived-only on the
  sparse projection; the sparse rows carry `archived_at` / `retention_until`.
- _(plus the Alembic 015 round-trip, verified in DELIVER.)_

**Frontend vitest:**
- `core/coldStorage/__tests__/daysLeft.test.ts` — `null` when `retention_until` is null;
  a positive count for a future retention end (injected `now`); a negative/zero count once
  retention has elapsed; deterministic with the injected clock (no real `Date.now()`).
- `useDatasetMutations.test.tsx` (+`useArchiveDataset`/`useRestoreDataset` blocks) — archive
  optimistically removes the dataset from the live list cache + invalidates live/archived/
  detail on settle + calls `catalog.archiveDataset(id)`; restore optimistically removes from
  the archived list cache + invalidates + calls `catalog.restoreDataset(id)`; rollback on
  error for both.
- `ColdStorageDrawer.test.tsx` — closed renders nothing; open lists the archived sources
  with retired-at / retention-end / a days-left badge and a Restore button that fires the
  restore mutation; empty archived list renders the random-food empty-state
  (`cold-storage-empty`); the displayed label falls back to `name` when `display_name` is null.
- `PipelineColdStorage.test.tsx` — the fridge toolbar button opens the drawer; an archived
  source is ABSENT from the live graph and its downstream view renders orphaned; restoring
  re-adds it; plus the `@walking_skeleton` archive→orphan→restore round trip.
- `UploadModalArchive.test.tsx` — the existing-source step shows a snowflake archive button;
  clicking it opens a ConfirmDialog; confirm fires `useArchiveDataset` and closes the modal;
  cancel dismisses the dialog WITHOUT archiving.

## What the doubles CANNOT model
- happy-dom does not apply the token stylesheet → no Neobrutalist/Solarized contrast, glass,
  snowflake/fridge glyph, or random-food styling assertions (MR-8 Playwright pass).
- The doubled `archiveDataset`/`restoreDataset`/`listDatasetsForProject` do not model real
  network latency or HTTP errors beyond a thrown rejection (covered by the existing
  dataCatalog REST contract tests).
- **Org-configurable retention window** is NOT modeled — the 90-day window is a hardcoded
  server constant (DWD-M7-4); making it org-configurable needs the deferred functional
  org-settings surface (§3.3).
- days-left is a pure FE derivation off `retention_until` (DWD-M7-5); the backend stores no
  countdown, so no backend test asserts a day count.
