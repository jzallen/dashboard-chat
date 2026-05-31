# DISTILL Wave Decisions — pipeline-layers-ui-redesign / MR-7

Slice: **MR-7 — Cold storage / retention (the redesign's LAST and heaviest
backend touch: TWO additive nullable columns `archived_at` + `retention_until`,
ONE migration 015, TWO thin endpoints archive/restore, and default-exclude /
`?archived=true` list filtering).**
Scope/decision source: `../path-forward.md` §2.7 (cold storage / fridge: archive a
source → leaves lineage → cold-storage list with retired-at / retention-end /
days-left / restore; snowflake buttons, fridge toolbar, random-food empty state),
§3.1 (additive backend surface — `archived_at` + `retention_until` nullable columns;
list filters out `archived_at IS NOT NULL` by default + `?archived=true` for the
cold-storage list; two thin endpoints `POST /api/datasets/{id}/archive` + `/restore`;
days-left computed FRONTEND-side from `retention_until`; retention window default 90d
is a read-only org default), §3.5 (orphan = non-source node whose inputs are all
absent-or-archived — DERIVED in the lineage builder, never persisted), §5 MR-7, §9
(single Neobrutalist + Solarized `.dark`; no aesthetic switcher).
DESIGN-equivalent SSOT — no `docs/product/` journeys cover this redesign and no
DISCUSS user-stories exist (mirrors MR-1..MR-6). MR-7 artifacts are namespaced `-mr7`
so the MR-1..MR-6 DISTILL/DELIVER records are preserved unchanged.

Prior-wave reading (READING ENFORCEMENT):
- `+ docs/feature/pipeline-layers-ui-redesign/path-forward.md` (§2.7, §3.1, §3.5, §5 MR-7, §9)
- `+ docs/feature/pipeline-layers-ui-redesign/design/ui-state-layout-integration-review.md` (R1 — hold FE↔wire coupling until ADR-046; MR-7 must NOT touch the ui-state wire)
- `+ docs/feature/pipeline-layers-ui-redesign/distill/roadmap-mr6.json`
- `+ docs/feature/pipeline-layers-ui-redesign/distill/wave-decisions-mr6.md`
- `+ docs/feature/pipeline-layers-ui-redesign/distill/walking-skeleton-mr6.md`
- `+ docs/feature/pipeline-layers-ui-redesign/deliver/wave-decisions-mr6.md`
- `+ docs/feature/pipeline-layers-ui-redesign/distill/upstream-issues.md`
- `+ frontend/src/core/lineage/buildGraph.ts` (the existing `archived: ReadonlySet<string>` seam — MR-2 passed an EMPTY set; MR-7 feeds the live set)
- `- docs/product/journeys/*` (none cover this redesign — graceful degradation, ACs derived from DESIGN §2.7/§3.1/§3.5)
- `- docs/product/architecture/brief.md` "For Acceptance Designer" section (absent — FE driving port = the rendered surface)
- `- docs/product/kpi-contracts.yaml` (not found — soft gate)
- `- docs/feature/pipeline-layers-ui-redesign/{discuss,design/wave-decisions,devops,spike}/*` (none — path-forward.md is the DESIGN SSOT)

Wave-decision reconciliation: **0 contradictions.** MR-7 is exactly the additive
`archived_at` + `retention_until` columns + archive/restore endpoints + list filtering
that §3.1 specifies and the MR-6 deliver record names as the carry-forward ("MR-7
carries the redesign's other backend touch"). Archive/restore reuse the EXISTING
generic update path (`update_dataset` → `MetadataRepository.update_dataset(**kwargs)`
generic `setattr`); the lineage reuses the EXISTING `buildGraph(..., archived)` seam
that MR-2 already built (MR-7 only feeds the real set instead of `new Set()`). The
ui-state wire / chat transport / agent contract are NOT touched. Reconciliation passed —
proceed.

---

## DWD-M7-1 — Walking Skeleton Strategy: C (real local I/O), backend pytest + frontend vitest
**Decision:** Strategy C — no costly/external deps (mirrors MR-1..MR-6). The driven
ports MR-7 touches are the new **`archive_dataset` / `restore_dataset` use cases** and
the **`list_datasets` / `list_datasets_for_project` filter** over the seeded SQLite
session, and on the frontend the **existing dataCatalog client** (new `archiveDataset`
/ `restoreDataset` POST calls + an `archived` list option). The acceptance gate is the
**standard backend pytest suite + standard frontend vitest suite** — NO separate
`tests/acceptance/<feature>/` pytest suite (none exists for this feature; the brief
pre-bakes this). The walking-skeleton thin slice is the archive→orphan→restore round
trip proven at two levels: backend `test_archive_dataset` (archive sets
`archived_at` + `retention_until = archived_at + 90d`) and the FE
`PipelineColdStorage.test > "@walking_skeleton archiving a source removes it from the
live lineage and orphans its downstream; restoring brings it back"`. Pre-baked per the
headless brief; not gated on interactive WS confirmation.

## DWD-M7-2 — happy-dom limitation: assert STRUCTURE/VALUES/NAVIGATION, not computed colors
**Decision:** happy-dom does not apply stylesheets, so the FE tests assert testids,
rendered values (retired-at / retention-end text, the days-left count, the archived
list rows), the orphan structure (`aria-disabled` on downstream nodes, archived source
node ABSENT from the live graph), the confirm-dialog open/confirm/cancel flow, the
fridge toolbar button + drawer open/close, and the random-food empty-state testid —
**never** computed colors, the snowflake glyph styling, or the MR-1 token values.
Neobrutalist/Solarized pixel + contrast fidelity is deferred to the MR-8
Playwright/visual pass (mirrors MR-1..MR-6).

## DWD-M7-3 — Backend touch is TWO additive nullable columns + 2 thin endpoints + 1 migration + list filter; ui-state wire NOT touched
**Decision (load-bearing, saved-feedback constraint):** the entire backend touch:
- ORM: `DatasetRecord.archived_at: Mapped[datetime | None]` + `retention_until:
  Mapped[datetime | None]` (`DateTime`, nullable, UTC-valued — mirrors the existing
  `created_at`/`updated_at` columns which are plain `DateTime` storing `datetime.now(UTC)`).
- Domain: `Dataset.archived_at` + `Dataset.retention_until` (ISO strings on the wire),
  mapped in `from_record` (`_iso`-formatted) and emitted in `serialize`; the sparse
  projection (`_sparse_dict` in `list_datasets_for_project`) gains both too.
- Schemas: `DatasetResponse` + `DatasetSparse` gain `archived_at: datetime | None` +
  `retention_until: datetime | None` on reads.
- Two NEW thin use cases: `archive_dataset(dataset_id)` sets `archived_at = now` and
  `retention_until = now + RETENTION_WINDOW` via the EXISTING generic
  `MetadataRepository.update_dataset(**kwargs)`; `restore_dataset(dataset_id)` clears
  both (`archived_at = None`, `retention_until = None`). Both follow the decorator stack
  (`@handle_returns` / `@with_repositories`), raise `DatasetNotFound` when absent, and
  return the refreshed domain `Dataset`.
- Endpoints: `POST /api/datasets/{id}/archive` + `POST /api/datasets/{id}/restore`
  wired through `DatasetController.archive_dataset` / `restore_dataset` (mirrors the
  existing `patch_dataset` controller shape).
- List filtering: the repository `list_datasets` gains an `archived: bool | None`
  filter — `None`/`False` ⇒ default EXCLUDE rows where `archived_at IS NOT NULL`;
  `True` ⇒ return ONLY archived rows. Threaded through the `list_datasets` /
  `list_datasets_for_project` use cases and the `GET /api/datasets` /
  `GET /api/projects/{id}/datasets` routers via an `?archived=true` query param. The
  filter is pushed into the org_id-scoped repository query (the existing
  `project_id`-scoped `select`).
- Alembic: ONE migration (015) revising from head `a4b5c6d7e8f9`, adding the two
  nullable timestamp columns with a real `downgrade` (drop both, reverse order).
  SQLite-dev/PostgreSQL-prod safe — plain nullable `add_column` (no `alter_column`, no
  batch op; per the alembic-migration skill). No `org_id` index is added: the `datasets`
  table has **no `org_id` column** (it is org-scoped transitively via `project_id`,
  which is already indexed), so the skill's org_id-index requirement does not apply.
**No ui-state wire / chat transport / agent contract touch. No new table.** (MR-7 is the
LAST backend-touching slice; MR-8 is frontend-only polish.)

## DWD-M7-4 — RETENTION_WINDOW = 90 days, a hardcoded module constant (org settings NOT functional, §3.3)
**Decision:** per §3.3 the org-settings surface is display-only / not functional in this
redesign, so the retention window is **hardcoded to 90 days** as a documented module
constant `RETENTION_WINDOW = timedelta(days=90)` in `app/use_cases/dataset/archive_dataset.py`.
`retention_until` is computed server-side at archive time (`archived_at + RETENTION_WINDOW`).
An org-configurable retention window is explicitly OUT of scope (would require the
functional `GET/PATCH /api/orgs/me/settings` surface deferred in §3.3). Documented; not
blocked.

## DWD-M7-5 — days-left is FRONTEND-derived from `retention_until` (pure, injected clock)
**Decision (§3.1):** there is NO stored countdown. Days-left is computed on the frontend
by a pure helper `daysLeft(retentionUntil: string | null, now: Date): number | null` in
`frontend/src/core/coldStorage/daysLeft.ts` — `null` when `retention_until` is unset,
otherwise `ceil((retentionUntil − now) / 1 day)` (negative once retention has elapsed).
`now` is INJECTED (not `Date.now()` inside the helper) so the unit test is deterministic
without faking the clock (per the brief). The cold-storage list passes `new Date()` at
render; the helper itself is clock-free and unit-tested directly.

## DWD-M7-6 — Orphan detection is the EXISTING `buildGraph` seam; MR-7 only FEEDS the live archived set (no logic reimplemented, §3.5)
**Decision (load-bearing, KEY EXISTING SEAM):** `buildGraph(datasets, views, reports,
archived)` already computes `orphan`/`archived`/`isLive` (MR-2). MR-7 does NOT change the
builder. Instead the data-connected `PipelineLanding`:
1. fetches the **live** (default, archived-EXCLUDED) sparse dataset list via the existing
   `useDatasets(projectId)` → these are the rendered graph nodes, so an archived source
   is ABSENT from the live graph ("leaves the live graph"); and
2. fetches the **archived** dataset ids via a new `useArchivedDatasets(projectId)`
   (`listDatasetsForProject(projectId, { archived: true })`) and feeds them as the real
   `archived` set into `buildGraph` (replacing MR-2's `new Set()`).
A downstream view/report whose `source_ref` points at the archived (now absent + archived)
dataset has zero live inputs ⇒ `orphan: true` ⇒ renders `aria-disabled` (existing
FlowView/LanesView behavior). Restore moves the dataset out of the archived list and back
into the default list ⇒ it reappears as a live node and its downstream re-links. The
archived set is the SSOT for "what is archived" and is fed defensively (so orphaning is
correct even if a future path includes archived rows in the present list). **No
`buildGraph` change; no new orphan logic.**

## DWD-M7-7 — Cold-storage UI: fridge toolbar entry + ColdStorageDrawer + snowflake archive + ConfirmDialog (reuses the modal pattern)
**Decision:**
- **Fridge toolbar entry** — a `fridge-toolbar-button` on the `PipelineLanding` toolbar
  (beside the MR-6 "Upload source" button) toggles a `ColdStorageDrawer`.
- **ColdStorageDrawer** (new `ui/components/ColdStorage/`) — lists archived sources from
  `useArchivedDatasets`; each row shows display-name (`display_name ?? name`), retired-at
  (`archived_at`), retention-end (`retention_until`), a days-left badge (the §DWD-M7-5
  pure helper, `new Date()` injected at render), and a Restore button firing
  `useRestoreDataset`. When the archived list is empty it renders a playful
  **random-food empty state** (`cold-storage-empty`, a deterministic-by-index food line —
  no `Math.random()`, which is unavailable/forbidden; a stable rotation keyed off the
  drawer is used so happy-dom tests are deterministic).
- **Snowflake archive (❄) + ConfirmDialog** — the archive trigger is a snowflake button
  in the MR-6 `UploadModal` existing-source step (the per-source management surface a
  source node already reopens). It opens a generic `ConfirmDialog` (new
  `ui/components/ConfirmDialog/`, reusing the `ActivityCheckModal` overlay/Esc/focus
  pattern); confirm fires `useArchiveDataset` and closes the modal, cancel dismisses the
  dialog only. This keeps the archive action on the source surface MR-6 established and
  does NOT alter the MR-2 node rendering (no new node prop), so the existing Pipeline
  view tests stay green. New behavior is covered by a dedicated `UploadModalArchive.test.tsx`
  (the existing `UploadModal.test.tsx` is untouched).
- All new chrome consumes MR-1 tokens via CSS modules; dark mode via `.dark`; no
  aesthetic switcher (§9). happy-dom asserts structure/values only (DWD-M7-2).

## DWD-M7-8 — archive/restore optimistic mutations (mirror MR-6 `useUpdateDatasetDisplayName`)
**Decision:** `useArchiveDataset(projectId)` and `useRestoreDataset(projectId)` live in
`useDatasetMutations.ts` beside `useRenameDataset` / `useUpdateDatasetDisplayName`, same
optimistic structure (cancel → snapshot → optimistic cache mutate → `onError` rollback →
`onSettled` invalidate exact):
- **archive** — optimistically REMOVES the dataset from the live list cache
  (`datasetKeys.list(projectId)`); `onSettled` invalidates the live list + the archived
  list (`datasetKeys.archived(projectId)`) + the detail — so the lineage recomputes
  (archived source gone, downstream orphaned) and the cold-storage list refreshes.
- **restore** — optimistically REMOVES the dataset from the archived list cache; settles
  by invalidating the live list + archived list + detail — so it reappears in the lineage.
A new `datasetKeys.archived(projectId)` key is added to the factory
(`[...datasetKeys.lists(), projectId, "archived"]`). The mutations call
`catalog.archiveDataset(id)` / `catalog.restoreDataset(id)` (no body) — no `name`/other
field is ever sent.

## DWD-M7-9 — Mandate 7 scaffolding, verified RED (not BROKEN)
**Decision:** RED-ready scaffolds:
- **Frontend (new modules)** — each marked `export const __SCAFFOLD__ = true`, bodies
  `throw new Error("Not yet implemented — RED scaffold …")` (NOT `NotImplementedError`):
  - `frontend/src/core/coldStorage/daysLeft.ts` (pure helper scaffold — throws until DELIVER)
  - `frontend/src/ui/components/ColdStorage/ColdStorageDrawer.tsx` (returns `null` when
    `open === false` so a closed drawer never throws — keeps `PipelineLanding` green until
    opened by a RED test) + `index.ts` barrel + `ColdStorage.module.css` (REAL CSS — cannot
    throw)
  - `frontend/src/ui/components/ConfirmDialog/index.tsx` (returns `null` when `open === false`)
    + `ConfirmDialog.module.css` (REAL CSS)
  - `frontend/src/ui/hooks/useDatasetMutations.ts` — `useArchiveDataset` + `useRestoreDataset`
    added as throwing scaffold exports (co-located; existing hooks + their tests untouched;
    tracked by the `RED scaffold` throw string, removed at GREEN — no module-level marker on
    this shared file)
- **Frontend (real, non-throwing, needed for the test files to typecheck)** — the TS type
  fields `Dataset.archived_at?`, `Dataset.retention_until?`, `DatasetSparse.archived_at?`,
  `DatasetSparse.retention_until?` in `frontend/src/core/dataCatalog/datasets.ts`; the new
  `archiveDataset` / `restoreDataset` client methods + the `archived` list option in
  `client.ts`; and the `datasetKeys.archived` factory entry (a type/client/factory cannot
  throw; mirrors MR-6 adding real types + reusing the real `updateDataset` client).
- **Backend RED** — minimal, clean assertion failures (NOT `AttributeError`/`ImportError`/BROKEN):
  - The two new use cases `archive_dataset` / `restore_dataset` exist as Python scaffolds
    (`__SCAFFOLD__ = True`, body `raise AssertionError("Not yet implemented — RED scaffold")`)
    and are exported from `app/use_cases/dataset/__init__.py` so the test imports resolve →
    the archive/restore tests fail RED on the assertion.
  - The ORM columns `DatasetRecord.archived_at` / `retention_until` are added REAL in the RED
    commit (a column cannot "throw"; needed so the list-filter tests can seed an archived row
    via `DatasetRecord(archived_at=…)` — without them seeding would `TypeError`/BROKEN).
  - The `list_datasets` / `list_datasets_for_project` use cases gain a REAL no-op
    `archived: bool | None = None` parameter in the RED commit so the filter tests can call
    them without a `TypeError`; the filter is NOT yet applied (the repo still returns all
    rows), so the default-exclude and archived-only tests fail RED on the row count/ids.
  No `__SCAFFOLD__` marker on the ORM/use-case-signature additions (they are real, just
  unwired); tracked by the failing assertions + the use-case scaffold markers.
**Verified RED (not BROKEN):** see the post-authoring run summary appended below.

## DWD-M7-10 — Test-boundary decisions (port-to-port, isolation)
- **Driving port (FE):** the rendered Pipeline landing / cold-storage drawer / upload-modal
  surfaces via `@testing-library/react` + `createRoutesStub`/`MemoryRouter` (mirrors
  MR-2..MR-6; the FE has no CLI/HTTP entry point). The user archives a source (snowflake →
  confirm), sees it leave the live lineage with its downstream orphaned, opens the fridge,
  sees it in cold storage with a days-left count, and restores it.
- **Driving port (BE):** the `archive_dataset` / `restore_dataset` / `list_datasets` use
  cases invoked directly with `set_session(seeded_db)` + `set_auth_user` (the
  `backend-use-case` test pattern) — the same ports the `POST /api/datasets/{id}/archive`,
  `/restore`, and `GET /api/datasets?archived=` routers wire (router→controller→use case
  is additive wiring verified in DELIVER; no TBU gap).
- **Driven ports doubled at the boundary:** `archiveDataset` / `restoreDataset` /
  `listDatasetsForProject` doubled via `vi.mock("@/dataCatalog")` (mirrors
  `useDatasetMutations.test`); the dataCatalog REST client is already contract-tested under
  `src/core/dataCatalog/__tests__/`, so NO new `@real-io @adapter-integration` FE scenario is
  added (mirrors MR-2..MR-6).
- **Backend driven port (real I/O):** `MetadataRepository.update_dataset` (archive/restore
  write) and `MetadataRepository.list_datasets` (the new archived filter) run against the
  real seeded SQLite session (`seeded_db`) — genuine `@real-io` persistence round-trips for
  the new columns + filter (Strategy C). The Alembic 015 round-trip
  (`upgrade head → downgrade -1 → upgrade head`) is verified in DELIVER as the adapter check.

## DWD-M7-11 — Single Neobrutalist + Solarized `.dark`; no aesthetic switcher
**Decision:** `ColdStorage.module.css` + `ConfirmDialog.module.css` consume the MR-1
`--color-*` / `--border-width` / `--radius` / `--shadow` / `--glass` tokens; no `.theme-*`
selector (§9 Option A locked). Dark mode is respected via the orthogonal `.dark` root class
(MR-1). No appearance control is introduced here. Snowflake/fridge/random-food visual
fidelity is deferred to MR-8.

---

## Adapter coverage table (Mandate 6)
| Adapter | @real-io scenario | Covered by |
|---------|-------------------|------------|
| `MetadataRepository.update_dataset` (archive/restore write of `archived_at`/`retention_until`) | YES | backend `test_archive_dataset` / `test_restore_dataset` over the real seeded SQLite session + the Alembic 015 round-trip (DELIVER) |
| `MetadataRepository.list_datasets` (new `archived` filter) | YES | backend `test_list_datasets` (default-exclude + archived-only) + `test_list_datasets_for_project` over the real seeded SQLite session |
| dataCatalog `archiveDataset` / `restoreDataset` (→ `POST /api/datasets/{id}/archive`/`/restore`) | N/A — thin new client methods; the REST client is contract-tested under `src/core/dataCatalog/__tests__/` | doubled at the port in the mutation + UI tests (mirrors MR-2..MR-6) |
| dataCatalog `listDatasetsForProject` (→ `GET /api/projects/{id}/datasets?archived=`) | N/A — pre-existing client; contract-tested | doubled at the port in the cold-storage + lineage tests |

No new driven adapter with real network I/O is introduced by MR-7 → no `NO — MISSING` rows.

## Self-review checklist
- [x] WS strategy declared (DWD-M7-1): backend pytest + frontend vitest, Strategy C.
- [x] Gate is the standard backend pytest + frontend vitest suites; structure/values/navigation asserted, not colors (DWD-M7-2).
- [x] Every driven adapter has a @real-io scenario or is a pre-existing contract-tested client (table above) → no missing rows.
- [x] InMemory/double limits documented: happy-dom can't model the CSS cascade/tokens, the snowflake/fridge glyphs, or the random-food styling; the doubled clients can't model real network latency/errors (covered by REST contract tests); org-configurable retention is out of scope (hardcoded 90d, DWD-M7-4).
- [x] Mandate 7: new FE modules carry `__SCAFFOLD__` + `throw new Error` (RED, not `NotImplementedError`/ImportError); backend RED is clean assertion failures (use-case scaffolds raise `AssertionError`; list-filter tests fail on counts); ORM columns / use-case params / TS types / client methods added real (cannot throw).
- [x] No `__SCAFFOLD__` / `RED scaffold` throw expected to remain after DELIVER (grep gate in roadmap).
- [x] Driving-adapter: FE driving port = the rendered landing/drawer/modal surfaces (no CLI/HTTP/hook); BE driving port = the archive/restore/list use cases the routers wire (no TBU).
- [x] Error/edge coverage ≥ 40%: archive of a missing dataset (Failure), restore of a missing dataset (Failure), default-exclude vs archived-only filtering, days-left null (no retention) + negative (elapsed), confirm-dialog cancel (no archive), random-food empty state, mutation rollback on error, downstream-orphaned derivation — comfortably exceeds 40%.

---

## RED run summary (verified RED, not BROKEN)
**Backend** — `uv run pytest tests/use_cases/dataset/{test_archive_dataset,test_restore_dataset,
test_list_datasets,test_list_datasets_for_project}.py -q`: **19 collected, 9 failed / 10
passed, 0 import/collection errors**. The 9 failures are RED: the archive/restore use-case
scaffolds raise `AssertionError("Not yet implemented — RED scaffold …")` (wrapped as
`Failure` by `@handle_returns` → the `Success` assertions `pytest.fail`), and the four
list-filter cases fail on a clean count/id `AssertionError` (the archived row is still
returned — the `archived` param is accepted but not yet threaded into the repo query). The
10 passes are the pre-existing list cases (proving the no-op `archived` param + the additive
ORM columns leave current behavior unchanged). No `AttributeError`/`ImportError` → no BROKEN.

**Frontend** — `npx vitest run` over the 5 MR-7 files (`daysLeft.test.ts`,
`useDatasetMutations.test.tsx`, `ColdStorageDrawer.test.tsx`, `PipelineColdStorage.test.tsx`,
`UploadModalArchive.test.tsx`): **36 collected, 22 failed / 14 passed, 0 import/resolve
errors**. The 22 failures are RED — `throw new Error("Not yet implemented — RED scaffold …")`
(daysLeft, useArchiveDataset, useRestoreDataset, ColdStorageDrawer, ConfirmDialog) and
`TestingLibraryElementError: Unable to find an element` for the not-yet-rendered
`fridge-toolbar-button` / `cold-storage-*` / `archive-source-button` / `archive-confirm-dialog`.
The 14 passes are the pre-existing `useRenameDataset` + `useUpdateDatasetDisplayName` cases
(no regression in the shared mutations file), the closed-drawer null-render case, and the
characterization case that an archived source absent from the live list already drops from
the graph. No `Cannot find module` / `Failed to resolve` → no BROKEN.

**Conclusion:** RED-ready, not BROKEN. DELIVER replaces the scaffold bodies (GREEN), wires the
backend columns/endpoints/filter + migration 015 (the 9 pytest cases → GREEN, migration
round-trips), and removes the `__SCAFFOLD__` markers + `RED scaffold` throws (grep gate →
empty under `src/`).
