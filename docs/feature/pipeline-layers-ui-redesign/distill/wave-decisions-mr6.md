# DISTILL Wave Decisions — pipeline-layers-ui-redesign / MR-6

Slice: **MR-6 — Standalone upload modal + editable source `display_name`
(the redesign's FIRST backend touch: ONE additive nullable `display_name` column).**
Scope/decision source: `../path-forward.md` §2.6 (upload flow: modal, cosmetic
3-leg dial-up progress over the existing single-step `uploadFile`, schema view from
the existing `schema_config`, editable display name persisted via `updateDataset`,
"upload another to same schema" / "create source", source-node reopen), §3.1 (Source:
`display_name` — additive backend surface; THIS MR adds ONLY `display_name`, NOT
`archived_at`/`retention_until` — those are MR-7), §3.2 (upload schema already served;
per-source file list NOT served — open q6), §5 (MR-6), §9 (single Neobrutalist +
Solarized `.dark`; no aesthetic switcher).
DESIGN-equivalent SSOT — no `docs/product/` journeys cover this redesign and no
DISCUSS user-stories exist (mirrors MR-1..MR-5). MR-6 artifacts are namespaced `-mr6`
so the MR-1..MR-5 DISTILL/DELIVER records are preserved unchanged.

Prior-wave reading (READING ENFORCEMENT):
- `+ docs/feature/pipeline-layers-ui-redesign/path-forward.md` (§2.6, §3.1, §3.2, §5 MR-6, open q6, §9)
- `+ docs/feature/pipeline-layers-ui-redesign/design-sources.md` (prototype `upload.jsx`/`upload.css` pulled on demand only — not needed; happy-dom asserts structure not pixels)
- `+ docs/feature/pipeline-layers-ui-redesign/distill/roadmap-mr5.json`
- `+ docs/feature/pipeline-layers-ui-redesign/distill/wave-decisions-mr5.md`
- `+ docs/feature/pipeline-layers-ui-redesign/distill/walking-skeleton-mr5.md`
- `+ docs/feature/pipeline-layers-ui-redesign/deliver/wave-decisions-mr5.md`
- `+ docs/feature/pipeline-layers-ui-redesign/distill/upstream-issues.md`
- `- docs/product/journeys/*` (none cover this redesign — graceful degradation, ACs derived from DESIGN §2.6/§3.1)
- `- docs/product/architecture/brief.md` "For Acceptance Designer" section (absent — UI-3; FE driving port = the rendered surface)
- `- docs/product/kpi-contracts.yaml` (not found — soft gate)
- `- docs/feature/pipeline-layers-ui-redesign/{discuss,design,devops,spike}/*` (none — path-forward.md is the DESIGN SSOT)

Wave-decision reconciliation: **0 contradictions.** MR-6 is exactly the additive
`display_name` field §3.1 specifies and the MR-5 deliver record names as a carry-forward
("MR-6 and MR-7 carry the redesign's only backend touches"). The upload reuses the
EXISTING `POST /api/uploads` + `uploadFile` client (no wire/transport change); the
display name reuses the EXISTING `PATCH /api/datasets/{id}` + `updateDataset` client
(generic `update_dict` already supports new fields). The created source already appears
as a node in the MR-2 lineage (a source IS a dataset — a `staging`-layer node from
`useDatasets`); no `buildGraph` change. Reconciliation passed — proceed.

---

## DWD-M6-1 — Walking Skeleton Strategy: C (real local I/O), backend pytest + frontend vitest
**Decision:** Strategy C — no costly/external deps (mirrors MR-1..MR-5 on the FE; the
backend touch is local SQLite + the in-process use case). The driven ports MR-6 touches
are the **existing dataCatalog `uploadFile`** client (→ `POST /api/uploads`, single-step),
the **existing `updateDataset`** client (→ `PATCH /api/datasets/{id}`), and on the backend
the **`update_dataset` use case** over the seeded SQLite session. The acceptance gate is
the **standard backend pytest suite + standard frontend vitest suite** — NO separate
`tests/acceptance/<feature>/` pytest suite is created (none exists for this feature; the
brief pre-bakes this). The walking-skeleton thin slice is the modal happy-path
(`UploadModal.test > "@walking_skeleton uploads a file, edits the display name, and
creates a source — display_name persisted, filename/name unchanged"`). Pre-baked per the
headless brief; not gated on interactive WS confirmation.

## DWD-M6-2 — happy-dom limitation: assert STRUCTURE/VALUES/NAVIGATION, not computed colors
**Decision:** happy-dom does not apply stylesheets, so the FE tests assert testids,
rendered values (schema field names, the display-name input value, the persisted
`display_name` argument), the dial-up progress STRUCTURE (3 legs present), modal
open/close, and node→modal reopen — **never** computed colors or the MR-1 token values.
The 3-leg dial-up animation is **cosmetic**; tests assert the legs render during the
in-flight upload, NOT their timing/active-frame (timing is non-deterministic under
happy-dom + would be flaky). Neobrutalist/Solarized pixel + contrast fidelity is deferred
to the MR-8 Playwright/visual pass (mirrors MR-1..MR-5).

## DWD-M6-3 — Backend touch is ONE additive nullable column; ui-state wire NOT touched; NO new endpoint/table
**Decision (load-bearing, saved-feedback constraint):** the entire backend touch is the
single additive nullable `display_name` column threaded through the existing additive
surface — NOT a new aggregate, table, or endpoint:
- ORM: `DatasetRecord.display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)`.
- Domain: `Dataset.display_name: str | None = None` (+ mapped in `from_record`, emitted in `serialize`).
- Schemas: `DatasetUpdate.display_name: str | None = None`; `DatasetResponse.display_name: str | None = None`.
- Use case / repository: **NO change** — `update_dataset(update_dict)` passes through and
  `MetadataRepository.update_dataset(**kwargs)` already does generic `setattr` (verified).
- Alembic: ONE migration (014) revising from head `f3a4b5c6d7e8`, adding the nullable column,
  with a real `downgrade` (drop_column). SQLite-dev/PostgreSQL-prod safe — a plain nullable
  `add_column` is portable (no `alter_column`, no batch op required; per alembic-migration skill).
The upload uses the EXISTING `uploadFile` → `/api/uploads`; reads/updates use the EXISTING
dataCatalog hooks. **No ui-state wire / chat transport / agent contract touch. No new backend
endpoint or table beyond the one nullable column.** (MR-7 owns `archived_at`/`retention_until`
+ archive/restore endpoints — explicitly NOT in MR-6.)

## DWD-M6-4 — "Source" is a THIN EXTENSION of the dataset record, not a new aggregate (§3.1)
**Decision:** a "source" is the existing `Dataset` record with an editable `display_name`.
A created source therefore already appears as a `staging`-layer node in the MR-2 lineage
(`buildGraph` renders every dataset as a node from `useDatasets`) — **no `buildGraph`
change and no new "source" layer population is required in MR-6.** The display name is a
PRESENTATION overlay: the UI shows `display_name ?? name`; the underlying `name`/filename
is never mutated by the display-name edit (the editor sends ONLY `{ display_name }`).

## DWD-M6-5 — Cosmetic 3-leg dial-up progress over the existing single-step upload (§2.6)
**Decision:** there is NO streaming-upload backend. The 3-leg "dial-up" progress is a
purely cosmetic animation wrapped around the in-flight existing `uploadFile` promise
(one network call). Tests assert the progress container + its 3 legs render while the
upload promise is pending and that the parsed schema view appears once it resolves —
NOT per-leg timing (DWD-M6-2). No `/api/uploads` change; no progress/SSE endpoint.

## DWD-M6-6 — Per-source upload history (open q6) → NOT served today; explicit empty-state, deferred (c)
**Decision (resolved by code inspection, NOT blocked):** the uploads router
(`backend/app/routers/uploads.py`) exposes only `POST ""`, `POST /{id}/process`, and
`GET /formats` — there is **no list-uploads-by-dataset / per-source history endpoint**,
and no `listUploads` client function exists. So the modal's per-source file list (names +
rows + when) renders a documented **empty-state** (`upload-history-empty`) best-effort.
Building a queryable upload-history feed requires a NEW backend read endpoint — a deferred
**(c)** logged in `upstream-issues.md` UI-7. **NOT built in MR-6** (the only backend touch
is the one `display_name` column). Not blocking.

## DWD-M6-7 — Editable display name surfaces in BOTH the modal AND the dataset-detail surface
**Decision:** the editable display name is a reusable `DisplayNameEditor` component
(persists via the new `useUpdateDatasetDisplayName` optimistic mutation; input defaults to
`display_name ?? name`; sends ONLY `{ display_name }`). It mounts (1) in the upload modal's
post-upload step and (2) on the MR-5 dataset-detail surface (`TableView`) as an additive
control — honoring "the editable display name lives on the model-detail surface"
(path-forward context). `ModelDetailLayout` is NOT modified (its `title` stays the raw
`name`); the editor is an additive child section, so the 8 existing `TableView.detail`
cases are unaffected (verified design — they assert `model-detail-title` = `name`, which
is unchanged).

## DWD-M6-8 — Standalone modal, detached from the assistant (§2.6/§9 retained-behavior 5)
**Decision:** the upload modal is a standalone `role="dialog" aria-modal` surface
(reusing the `ActivityCheckModal` overlay/focus-trap/Esc pattern), **toolbar-triggered on
the Pipeline landing surface — NOT inside the chat/assistant** (the design deliberately
detaches upload from the assistant). The existing chat `UploadWidget` is left untouched
(it remains the in-chat path); MR-6 adds the new standalone modal alongside it.

## DWD-M6-9 — Source-node reopen via an ADDITIVE optional `onNodeActivate` (no MR-2 regression)
**Decision:** clicking a source node reopens the modal in `existingSource` mode (schema +
editable display name + "upload another to same schema", browse step skipped). This is
wired by an **additive optional** `onNodeActivate?(node)` prop threaded
`PipelineLanding → PipelineCanvas → Flow/Lanes/Audit views`; when absent (every existing
MR-2 test), nodes render exactly as today (no role/onClick change observable to those
tests). `PipelineLanding` holds the modal open-state and renders `<UploadModal>` (which
returns `null` while closed). The RED reopen test asserts the INTENDED behavior (click a
node → modal opens) and fails fast (`getByTestId` throws — the wiring + modal don't exist
yet), so it does not depend on touching MR-2 components in the RED commit.

## DWD-M6-10 — Mandate 7 scaffolding, verified RED (not BROKEN)
**Decision:** RED-ready scaffolds:
- **Frontend (new modules)** — each marked `export const __SCAFFOLD__ = true`, bodies
  `throw new Error("Not yet implemented — RED scaffold …")` (NOT `NotImplementedError`):
  - `frontend/src/ui/components/UploadModal/UploadModal.tsx` (returns `null` when
    `open === false` so a closed modal never throws — keeps `PipelineLanding`/other hosts
    green; throws only when actually opened by a RED test)
  - `frontend/src/ui/components/UploadModal/DisplayNameEditor.tsx`
  - `frontend/src/ui/components/UploadModal/index.ts` (barrel)
  - `frontend/src/ui/components/UploadModal/UploadModal.module.css` (REAL CSS consuming MR-1
    tokens — CSS cannot scaffold-throw; mirrors MR-5's `ModelDetail.module.css`)
  - `frontend/src/ui/hooks/useDatasetMutations.ts` — `useUpdateDatasetDisplayName` added as a
    throwing scaffold export (co-located with the existing `useRenameDataset`; the existing
    hook + its tests are untouched). No module-level `__SCAFFOLD__` marker here (shared file);
    tracked by the `RED scaffold` throw string, removed at GREEN.
- **Frontend (real, non-throwing, needed for the test files to typecheck)** — the TS type
  fields `Dataset.display_name?`, `DatasetSparse.display_name?`, `DatasetUpdate.display_name?`
  in `frontend/src/core/dataCatalog/datasets.ts` (a type cannot throw; mirrors MR-5 adding
  real CSS in the RED commit).
- **Backend RED** — the use-case test asserts `dataset.display_name == "<new>"`. The minimal
  RED scaffold is the domain field `Dataset.display_name: str | None = None` ONLY (attribute
  exists → the assertion fails with `None`, a clean **RED** assertion, not an
  `AttributeError`/BROKEN). It is intentionally NOT yet mapped in `from_record`/`serialize`,
  not added to the ORM, and not migrated — DELIVER 06-01 wires it through (GREEN). No
  `__SCAFFOLD__` marker for the backend (the field is real, just unwired); tracked by the
  failing assertion. Existing `Dataset(...)`-equality tests are unaffected (default `None`
  on both sides).
**Verified RED (not BROKEN):** see the post-authoring run summary appended below.

## DWD-M6-11 — Test-boundary decisions (port-to-port, isolation)
- **Driving port (FE):** the rendered modal/landing surface — the user opens the modal from
  the toolbar or by activating a source node, picks a file, sees the schema + edits the
  display name, and creates the source. Exercised via `@testing-library/react` +
  `createRoutesStub`/`MemoryRouter` (mirrors MR-2..MR-5; the FE has no CLI/HTTP entry point).
- **Driving port (BE):** the `update_dataset` use case invoked directly with
  `set_session(seeded_db)` + `set_auth_user` (the `backend-use-case` test pattern) — the same
  port the `PATCH /api/datasets/{id}` router already wires (router→controller→use case
  verified; no TBU gap, the router path is unchanged additive wiring).
- **Driven ports doubled at the boundary:** `uploadFile` + `updateDataset` doubled via the
  `vi.mock("@/dataCatalog")` pattern (mirrors `useDatasetMutations.test`); the dataCatalog
  REST client is already contract-tested under `src/core/dataCatalog/__tests__/`, so NO new
  `@real-io @adapter-integration` scenario is added (mirrors MR-2..MR-5).
- **Backend driven port (real I/O):** the `MetadataRepository.update_dataset` runs against the
  real seeded SQLite session (`seeded_db`) — a genuine `@real-io` persistence round-trip for
  the new column (Strategy C). The Alembic migration round-trip
  (`upgrade head → downgrade -1 → upgrade head`) is verified in DELIVER as the adapter check.

## DWD-M6-12 — Single Neobrutalist + Solarized `.dark`; no aesthetic switcher
**Decision:** `UploadModal.module.css` consumes the MR-1 `--color-*`/`--border-width`/
`--radius`/`--shadow`/`--glass` tokens; no `.theme-*` selector (§9 Option A locked). Dark
mode is respected via the orthogonal `.dark` root class (MR-1). No appearance control is
introduced here.

---

## Adapter coverage table (Mandate 6)
| Adapter | @real-io scenario | Covered by |
|---------|-------------------|------------|
| `MetadataRepository.update_dataset` (new `display_name` column persistence) | YES | backend `test_update_dataset_when_display_name_provided_persists` over the real seeded SQLite session + the Alembic 014 round-trip (DELIVER) |
| dataCatalog `uploadFile` (→ `POST /api/uploads`) | N/A — pre-existing client; contract-tested under `src/core/dataCatalog/__tests__/` | doubled at the port in the modal tests (mirrors MR-2..MR-5) |
| dataCatalog `updateDataset` (→ `PATCH /api/datasets/{id}`) | N/A — pre-existing client; contract-tested under `src/core/dataCatalog/__tests__/` | doubled at the port in the mutation + modal tests |

No new driven adapter with real network I/O is introduced by MR-6 → no `NO — MISSING` rows.

## Self-review checklist
- [x] WS strategy declared (DWD-M6-1): backend pytest + frontend vitest, Strategy C.
- [x] Gate is the standard backend pytest + frontend vitest suites; structure/values/navigation asserted, not colors (DWD-M6-2).
- [x] Every driven adapter has a @real-io scenario or is a pre-existing contract-tested client (table above) → no missing rows.
- [x] InMemory/double limits documented: happy-dom can't model the CSS cascade/tokens or the dial-up timing; the doubled `uploadFile`/`updateDataset` can't model real network latency/errors (covered by the REST contract tests); per-source upload history is not served (deferred c, UI-7).
- [x] Mandate 7: new FE modules carry `__SCAFFOLD__` + `throw new Error` (RED, not `NotImplementedError`/ImportError); backend RED is a clean assertion failure (display_name `None`); types/CSS added real (cannot throw).
- [x] No `__SCAFFOLD__` / `RED scaffold` throw expected to remain after DELIVER (grep gate in roadmap).
- [x] Driving-adapter: FE driving port = the rendered modal/landing surface (no CLI/HTTP/hook); BE driving port = the `update_dataset` use case the `PATCH` router already wires (no TBU).
- [x] Error/edge coverage ≥ 40%: upload error + retry, modal close (Esc/overlay/close button), display-name fallback-to-name (null), upload-history empty-state, dataset-not-found (backend), DB-error Failure (existing), reopen-without-wiring RED — comfortably exceeds 40%.

---

## RED run summary (verified RED, not BROKEN)
**Frontend** — `npx vitest run` over the 5 MR-6 files (`DisplayNameEditor.test.tsx`,
`UploadModal.test.tsx`, `PipelineUploadReopen.test.tsx`, `TableView.displayName.test.tsx`,
`useDatasetMutations.test.tsx`): **29 collected, 21 failed / 8 passed, 0 import/resolve
errors**. All 21 failures are RED — `throw new Error("Not yet implemented — RED scaffold …")`
(UploadModal, DisplayNameEditor, useUpdateDatasetDisplayName ×5+) and
`TestingLibraryElementError: Unable to find an element` for the not-yet-rendered
`upload-modal` / `upload-source-button` / `display-name-input`. The 8 passes are the
pre-existing `useRenameDataset` cases (proving no regression in the shared mutations file).
No `Cannot find module` / `Failed to resolve` → no BROKEN.

**Backend** — `uv run pytest tests/use_cases/dataset/test_update_dataset.py -q`: **7
collected, 2 failed / 5 passed**. The 2 new cases fail on a clean
`AssertionError: assert None == 'Sales Snapshot'` / `'Renamed Source'` (the domain
`Dataset.display_name` attribute exists → `None` until DELIVER 06-01 wires
`from_record`/`serialize`/ORM/migration) — RED, not an `AttributeError`/BROKEN. The 5
pre-existing `update_dataset` cases still pass (the additive default-`None` domain field
leaves `Dataset(...)`-equality untouched).

**Conclusion:** RED-ready, not BROKEN. DELIVER replaces the scaffold bodies (GREEN) and
removes the `__SCAFFOLD__` markers + `RED scaffold` throws (grep gate → empty under `src/`),
and wires the backend field (the 2 pytest cases → GREEN, migration round-trips).
