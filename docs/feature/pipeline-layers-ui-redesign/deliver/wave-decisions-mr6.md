# DELIVER Wave Decisions — pipeline-layers-ui-redesign / MR-6

Slice: MR-6 — Standalone upload modal + editable source `display_name` (the redesign's
FIRST backend touch: ONE additive nullable `display_name` column).
Roadmap: `../distill/roadmap-mr6.json` (3 sequential steps). DES record (this slice):
`deliver/mr6/{roadmap.json, execution-log.json}`.

Commits (atomic, sequential):
- `c73b7e6` — `test: RED suite + scaffolds for MR-6 upload modal + source display_name` (DISTILL RED + scaffolds: backend domain field + 2 cases, FE scaffolds + tests + TS types)
- `53c7030` — `docs(pipeline-ui-redesign): DISTILL artifacts for MR-6 upload modal + display_name`
- `e9f604a` — `feat(backend): add additive display_name column to datasets (MR-6 step 06-01)`
- `20cffee` — `feat(frontend): useUpdateDatasetDisplayName optimistic mutation (MR-6 step 06-02)`
- `941dd05` — `feat(frontend): standalone upload modal + source-node reopen + display-name editor (MR-6 step 06-03)`

## Outcome
- **All 3 steps COMMIT/PASS.** Each ran the DES TDD phases (PREPARE / RED_ACCEPTANCE /
  [RED_UNIT SKIPPED] / GREEN / COMMIT); `verify_deliver_integrity` over
  `deliver/mr6/execution-log.json` → "All 3 steps have complete DES traces" (PASS). The
  committed DES record lives at `deliver/mr6/` directly (driven inline — no transient dir;
  mirrors MR-5 DWD-M5-D6).
- **Acceptance gate GREEN.** Backend: `uv run pytest --extra test` → **1350 passed / 0
  failed** (incl. the 2 new `test_update_dataset_when_display_name_provided_persists` +
  `test_update_dataset_display_name_is_independent_of_name`). Migration 014 round-trips
  `upgrade head → downgrade -1 → upgrade head` clean on SQLite. `ruff check` clean.
  Frontend: full `npx vitest run` → **94 files / 765 passed / 0 failed** (up from 743 at
  MR-5; +22 MR-6 cases: UploadModal 11, DisplayNameEditor 3, useUpdateDatasetDisplayName 5,
  PipelineUploadReopen 2, TableView.displayName 1). Zero `__SCAFFOLD__` / `RED scaffold`
  throws remain in the MR-6 files.
- **Sequential dispatch honored.** Backend FIRST (06-01) so the FE built on a real persisted
  field; each step verified (scenarios green, no theater, no scaffold left, migration
  round-trips, no regression) before the next.
- **Adversarial review (Phase 4): APPROVE, no defects, no revision.**
  `nw-software-crafter-reviewer` confirmed all 7 MUST-HOLD constraints: ui-state wire /
  chat transport / agent contract untouched (no `@dashboard-chat/ui-state-wire` /
  `lib/ui-state-client` import; no new chat/stream client; no new endpoint/table beyond the
  one nullable column); display_name additive (editor + mutation send ONLY `{ display_name }`,
  filename/name never mutated, UI falls back to name); migration SQLite/PostgreSQL-safe
  (plain nullable add_column + real downgrade, revises from `f3a4b5c6d7e8`); `onNodeActivate`
  additive-optional (no MR-2 regression — nodes render unchanged without a handler); no
  testing-theater; correct backend field flow (ORM → from_record → serialize → response;
  DatasetUpdate → model_dump(exclude_unset) → patch_dataset); correct optimistic
  rollback/invalidate; sound modal state machine; cosmetic dial-up not faking a real signal;
  hooks called unconditionally before early returns; `react-router` (not `-dom`).
- **DISTILL gate (prior): APPROVE** (nw-acceptance-designer-reviewer) — average 9.3/10, all
  four design mandates pass, 0 real blockers.

## Design / scope adherence
- **Backend = ONE additive nullable column (DWD-M6-3).** `DatasetRecord.display_name`
  (`String(255)`, nullable) + domain `Dataset.display_name` (mapped in `from_record`, emitted
  in `serialize`) + `DatasetUpdate.display_name` + `DatasetResponse.display_name` + Alembic
  014. The `update_dataset` use case and `MetadataRepository.update_dataset` are UNCHANGED
  (generic `update_dict` + generic `setattr` already carry the field — verified end-to-end).
  NO new endpoint or table.
- **"Source" = thin extension of the dataset record (DWD-M6-4).** A created source already
  appears as a `staging` lineage node via the existing `useDatasets` → `buildGraph` path; no
  `buildGraph` change. The display name is a presentation overlay (`display_name ?? name`).
- **Standalone modal detached from the assistant (DWD-M6-8).** Toolbar-triggered on the
  Pipeline landing surface; reuses the `ActivityCheckModal` overlay/Esc/close pattern; reuses
  the EXISTING `uploadFile` (`/api/uploads`, single step) + `updateDataset`
  (`PATCH /api/datasets/{id}`). The in-chat `UploadWidget` is left untouched.
- **Cosmetic 3-leg dial-up (DWD-M6-5).** A CSS keyframe animation wrapped around the in-flight
  `uploadFile` promise — no streaming-upload backend, no progress/SSE endpoint.
- **Source-node reopen (DWD-M6-9).** Additive optional `onNodeActivate` threaded
  PipelineLanding → PipelineCanvas → Flow/Lanes/Audit; fires only for `kind === "dataset"`
  nodes (PipelineLanding maps the node id back to its `DatasetSparse` and opens the modal in
  `existingSource` mode). Without a handler, nodes render exactly as in MR-2 (verified: the 13
  PipelineViews + 3 PipelineLanding cases still pass).
- **Editable display name on the detail surface (DWD-M6-7).** The reusable `DisplayNameEditor`
  mounts on `TableView` (dataset detail) and in the modal; `ModelDetailLayout` is unchanged
  (the 9 TableView.detail cases still assert `model-detail-title` = raw `name`).
- **Per-source upload history deferred (DWD-M6-6 / UI-7).** Not served by the API today (no
  list-uploads endpoint); the modal renders a documented `upload-history-empty` empty-state.
  No backend read endpoint invented.
- **Single Neobrutalist + Solarized `.dark` (DWD-M6-12).** `UploadModal.module.css` consumes
  the MR-1 tokens; no aesthetic switcher. Visual/contrast fidelity deferred to MR-8.

## Adaptations from the standard nw-deliver flow (per-MR slice)
- **DWD-M6-D1 — Acceptance gate is the standard backend pytest + frontend vitest suites,
  not a Python acceptance suite.** None exists for this feature (mirrors MR-1..MR-5).
  Phase-3.5's `pytest tests/acceptance/{feature}` is substituted by the full backend pytest +
  full frontend vitest green gate + the migration round-trip.
- **DWD-M6-D2 — Phase-3.5 Elevator-Pitch demo gate: N/A.** No DISCUSS user-stories exist for
  this feature, so there is no `After: run … → sees …` line to execute. Skipped (not
  applicable), not bypassed.
- **DWD-M6-D3 — Phase 3 dedicated refactor pass skipped.** The adversarial reviewer confirmed
  the diff clean (a thin additive backend field + a presentational modal + a reusable editor +
  additive optional wiring; no duplication worth extracting, no dead code). A separate RPP pass
  adds no value (mirrors MR-1..MR-5).
- **DWD-M6-D4 — Phase 5 mutation testing skipped.** The slice is a thin additive column + a
  presentational modal/editor + an optimistic mutation whose behavior is fully pinned by the
  example cases (persist + name-independence; cache optimistic/rollback/invalidate; modal
  state machine + reopen + upload-another; display-name fallback). Mutation on this surface is
  low-value; logged skip (mirrors MR-1..MR-5).
- **DWD-M6-D5 — Phase 7 finalize DEFERRED.** `nw-finalize` archives a *completed* feature.
  MR-6 is 6 of 8; finalize runs after MR-8. MR-6 lands incrementally via `gt mq submit`. No
  deliver-session marker was created (steps driven inline with manual `log_phase`), so none
  needed cleanup.
- **DWD-M6-D6 — DES log path: driven inline, committed directly under `deliver/mr6/`** (mirrors
  MR-5). The three steps were driven inline by the DELIVER orchestrator with manual `init_log`
  / `log_phase` / `verify_deliver_integrity`. Record written directly to
  `deliver/mr6/{roadmap.json,execution-log.json}`; integrity verified at the committed
  location (PASS). (The `verify_deliver_integrity` roadmap-format pre-check is skipped on the
  custom per-MR roadmap shape — a warning, not a failure; the execution-log trace check
  passed.)
- **DWD-M6-D7 — RED_UNIT logged SKIPPED across all three steps.** The DISTILL example cases ARE
  the unit/acceptance spec for this slice (mirrors MR-2/3/4/5).
- **DWD-M6-D8 — Backend run uses the `test` extra (pandera).** The full backend suite pulls
  `pandera` (declared in the `test` extra) via the integration harness; `uv run --extra test
  pytest` is used locally to run it cleanly (the queue's `--backend` excludes
  `tests/integration` by default, so the gate is unaffected either way). Pre-existing env
  detail, unrelated to MR-6.

## Known non-blocking nit (deferred / out of scope)
- A pre-existing stale comment `// … RED scaffold (created by DISTILL, MR-3)` remains in
  `frontend/src/ui/components/Breadcrumb/breadcrumbContext.ts` (a delivered MR-3 file, not an
  active `__SCAFFOLD__ = true` marker). Out of MR-6 scope — left untouched to avoid churn.

## Carry-forward
- **MR-7** (cold storage / retention) carries the redesign's other backend touch
  (`archived_at` + `retention_until` + archive/restore endpoints + a migration). MR-7's archive
  state feeds the MR-2 `buildGraph` the upload modal's created sources already flow through.
- **Deferred (c) — `distill/upstream-issues.md` UI-7:** per-source upload history (file list:
  names + rows + when) is not served today; the modal renders a documented empty-state.
  Revisit when an upload-history read endpoint is in scope (not MR-6, not MR-7's planned set).
- **MR-8** visual/contrast pass (Playwright) verifies the modal/editor chrome that happy-dom
  cannot assert.
