# DELIVER Wave Decisions — pipeline-layers-ui-redesign / MR-7

Slice: MR-7 — Cold storage / retention (the redesign's LAST and heaviest backend touch:
TWO additive nullable columns `archived_at` + `retention_until`, ONE migration 015, TWO
thin endpoints archive/restore, and default-exclude / `?archived=true` list filtering).
Roadmap: `../distill/roadmap-mr7.json` (3 sequential steps, backend-first). DES record
(this slice): `deliver/mr7/{roadmap.json, execution-log.json}`.

Commits (atomic, sequential):
- `4596b70` — `test: RED suite + scaffolds for MR-7 cold storage / retention` (DISTILL RED + scaffolds)
- `97a16c4` — `docs(pipeline-ui-redesign): DISTILL artifacts for MR-7 cold storage / retention`
- `c958125` — `feat(backend): cold-storage columns + archive/restore endpoints + list filtering (MR-7 step 07-01)`
- `c1c8039` — `feat(frontend): days-left helper + archive/restore optimistic mutations (MR-7 step 07-02)`
- `f68f4d0` — `feat(frontend): cold-storage fridge drawer + snowflake archive + live orphan wiring (MR-7 step 07-03)`
- (+ two `style: lint/format auto-fixes` follow-ups for the repo-wide pre-commit eslint pass)

## Outcome
- **All 3 steps COMMIT/PASS.** Each ran the DES TDD phases (PREPARE / RED_ACCEPTANCE /
  [RED_UNIT SKIPPED] / GREEN / COMMIT); `verify_deliver_integrity` over
  `deliver/mr7/execution-log.json` → "All 3 steps have complete DES traces" (PASS). The
  committed DES record lives at `deliver/mr7/` (driven inline — mirrors MR-5/MR-6 DWD-M6-D6).
- **Acceptance gate GREEN.** Backend: `uv run --extra test pytest` → **1378 passed / 22
  skipped / 2 pre-existing `tests/integration` failures** (FHIR multi-result +
  auth-proxy m2m context — both reproduce on base `38ba4a3`, unrelated to MR-7, and excluded
  from the queue `--backend` gate; verified via a throwaway worktree). The 132 dataset
  use-case tests are green incl. the 9 new MR-7 cases (archive 90d retention, restore clears,
  default-exclude + archived-only on both the full and sparse lists). Migration 015
  round-trips `upgrade head → downgrade -1 → upgrade head` clean on SQLite. `ruff check` +
  `ruff format --check` clean. Frontend: full `npx vitest run` → **98 files / 789 passed / 0
  failed** (up from 765 at MR-6; +24 MR-7 cases: daysLeft 5, useArchiveDataset 4,
  useRestoreDataset 3, ColdStorageDrawer 5, PipelineColdStorage 3, UploadModalArchive 4).
  Zero `__SCAFFOLD__` / `RED scaffold` throws remain in the MR-7 files.
- **Sequential dispatch honored.** Backend FIRST (07-01) so the FE built on the real
  persisted columns + endpoints + filter; each step verified (scenarios green, no theater,
  no scaffold left, migration round-trips, no regression) before the next.
- **Adversarial review (Phase 4): APPROVE, iteration 1, ZERO defects, no revision.**
  `nw-software-crafter-reviewer` confirmed all 8 MUST-HOLD constraints: ui-state wire / chat
  transport / agent contract untouched; backend purely additive (2 nullable cols + 2 thin
  endpoints + 1 reversible portable migration + a list filter; no new table; archive/restore
  reuse the generic update path); the EXISTING `buildGraph` orphan logic NOT reimplemented
  (PipelineLanding only FEEDS the live archived set); optimistic mutations correct
  (live/archived cache moves, rollback, settle-invalidate, no extra body, hooks before early
  returns); days-left pure + clock-injected, retention hardcoded 90d; no testing-theater, no
  scaffold markers, the controller char-test update is a legitimate additive change;
  `react-router` (not `-dom`), QueryClientProvider in tests, happy-dom-safe assertions; the
  snowflake archive + ConfirmDialog + drawer additive (no MR-2 / UploadModal regression).
- **DISTILL gate (prior): APPROVE** (nw-acceptance-designer-reviewer) — avg ~9.4/10, all
  mandates pass, 0 blockers (2 non-blocking nits noted below).

## Design / scope adherence
- **Backend = TWO additive nullable columns + 2 thin endpoints + 1 migration + a list filter
  (DWD-M7-3).** `DatasetRecord.archived_at` + `retention_until` (`DateTime`, nullable,
  UTC-valued) + domain `Dataset.{archived_at,retention_until}` (ISO strings via `_iso_or_none`
  in `from_record`, emitted in `serialize`) + the sparse projection (`_sparse_dict`) +
  `DatasetResponse` / `DatasetSparse` schema fields + Alembic 015 (revises `a4b5c6d7e8f9`).
  `archive_dataset` / `restore_dataset` reuse the EXISTING generic
  `MetadataRepository.update_dataset(**kwargs)` (no new repo write method); the list filter
  pushes into the existing `project_id`-scoped repo query. NO new table.
- **RETENTION_WINDOW = 90 days, hardcoded (DWD-M7-4).** `timedelta(days=90)` module constant
  in `archive_dataset.py`; `retention_until = archived_at + RETENTION_WINDOW` computed
  server-side at archive time. Org-configurable retention is deferred (UI-8, §3.3).
- **Orphan detection = the EXISTING buildGraph seam; MR-7 only FEEDS the live archived set
  (DWD-M7-6).** `PipelineLanding` fetches the default (archived-excluded) sparse list for the
  live graph AND `useArchivedDatasets` for the archived id set, fed into
  `buildGraph(..., archivedIds)` (replacing MR-2's `new Set()`). `buildGraph.ts` is
  UNCHANGED. An archived source is absent from the live list → leaves the live graph; its
  downstream view/report has zero live inputs → orphaned (existing FlowView/LanesView
  `aria-disabled`). Restore moves it back into the live list → it reappears and re-links.
- **days-left frontend-derived, pure, clock-injected (DWD-M7-5).** `daysLeft(retentionUntil,
  now)` — `null` when no retention, `ceil` days otherwise; the cold-storage drawer passes
  `new Date()` at render; the helper is clock-free and unit-tested directly.
- **Cold-storage UI (DWD-M7-7).** Fridge toolbar button → `ColdStorageDrawer` (archived list
  with retired-at / retention-end / days-left badge / restore + a deterministic random-food
  empty state). Snowflake archive (❄) + generic `ConfirmDialog` in the MR-6 UploadModal
  existing-source step (the per-source management surface); confirm fires `useArchiveDataset`
  + closes, cancel dismisses the dialog only. No MR-2 node-prop change → no Pipeline-view
  regression; the existing `UploadModal.test` is untouched (new behavior in
  `UploadModalArchive.test`).
- **Optimistic mutations (DWD-M7-8).** `useArchiveDataset` removes the source from the live
  list cache + invalidates live/archived/detail; `useRestoreDataset` removes it from the
  archived list cache + invalidates — mirroring MR-6 `useUpdateDatasetDisplayName`. New
  `datasetKeys.archived(projectId)` factory entry.
- **Single Neobrutalist + Solarized `.dark` (DWD-M7-11).** `ColdStorage.module.css` +
  `ConfirmDialog.module.css` consume the MR-1 tokens; no aesthetic switcher. Visual/contrast
  fidelity deferred to MR-8.

## Adaptations from the standard nw-deliver flow (per-MR slice)
- **DWD-M7-D1 — Acceptance gate is the standard backend pytest + frontend vitest suites, not
  a Python acceptance suite.** None exists for this feature (mirrors MR-1..MR-6). Phase-3.5's
  `pytest tests/acceptance/{feature}` is substituted by the full backend pytest + full
  frontend vitest green gate + the migration round-trip.
- **DWD-M7-D2 — Phase-3.5 Elevator-Pitch demo gate: N/A.** No DISCUSS user-stories exist for
  this feature, so there is no `After: run … → sees …` line to execute. Skipped (not
  applicable), not bypassed.
- **DWD-M7-D3 — Phase 3 dedicated refactor pass skipped.** The adversarial reviewer confirmed
  the diff clean (additive columns + 2 thin use cases + a presentational drawer/dialog +
  thin additive wiring; RPP L1-L2 scan clean, no duplication, no dead code). A separate RPP
  pass adds no value (mirrors MR-1..MR-6).
- **DWD-M7-D4 — Phase 5 mutation testing skipped.** Thin additive surface whose behavior is
  fully pinned by the example cases (retention math, cache moves/rollback/invalidate, filter
  default-exclude/archived-only, orphan wiring, confirm flow). Low-value; logged skip
  (mirrors MR-1..MR-6).
- **DWD-M7-D5 — Phase 7 finalize DEFERRED.** `nw-finalize` archives a *completed* feature.
  MR-7 is 7 of 8; finalize runs after MR-8. MR-7 lands incrementally via `gt mq submit`.
- **DWD-M7-D6 — DES log path: driven inline, committed directly under `deliver/mr7/`**
  (mirrors MR-5/MR-6). `init_log` / `log_phase` / `verify_deliver_integrity` driven inline by
  the DELIVER orchestrator; integrity verified at the committed location (PASS). The
  `verify_deliver_integrity` roadmap-format pre-check is skipped on the custom per-MR roadmap
  shape — a warning, not a failure; the execution-log trace check passed.
- **DWD-M7-D7 — RED_UNIT logged SKIPPED across all three steps.** The DISTILL example cases
  ARE the unit/acceptance spec for this slice (mirrors MR-2..MR-6).
- **DWD-M7-D8 — Backend run uses the `test` extra (pandera).** The full backend suite pulls
  `pandera` via the integration harness; `uv run --extra test pytest` runs it cleanly. The
  queue's `--backend` excludes `tests/integration` by default, so the 2 pre-existing
  integration failures are outside the gate path either way.
- **DWD-M7-D9 — Two PRE-EXISTING `tests/integration` failures, NOT MR-7 regressions.**
  `test_upload_pipeline.py::...test_fhir_single_type_bundle_creates_single_item_list` (FHIR
  multi-result returns a single Dataset) and
  `test_auth_proxy_m2m.py::...test_dev_m2m_headers_resolve_to_dev_user` ("No auth user in
  context") both reproduce on base commit `38ba4a3` (verified in a throwaway worktree).
  Unrelated to cold storage; excluded from the `--backend` gate; left untouched (Iron Rule).
- **DWD-M7-D10 — One controller characterization test updated.**
  `test_dataset_controller_char.py::...test_success_envelope_includes_pagination_metadata`
  asserted the controller forwards `("p1", cursor=…, page_size=…)` to the use case; the
  additive `archived=None` forwarding changed that call, so the char-test assertion was
  updated to `…, archived=None`. This is a legitimate update of a behavior-pinning
  characterization test for an intentional additive change — NOT gaming a failing spec.

## Known non-blocking nits (deferred / out of scope)
- **DISTILL nit (non-blocking):** no `test_restore_when_dataset_is_live` idempotency case.
  Restore clears `archived_at`/`retention_until` to `None` regardless of prior state (safe,
  idempotent); the happy + not-found paths are covered. Deferrable; not added.
- **Archived-only-project edge:** if a project's ONLY source is archived and it has no
  downstream, the live graph is empty → the MR-2 `pipeline-empty` state renders and the
  fridge toolbar (and thus restore) is unreachable from that view. Rare; the demo/common
  flow (archive a source WITH downstream, or in a multi-source project) keeps the graph
  non-empty and the fridge reachable. Noted for the MR-8 polish pass.

## Carry-forward
- **MR-8** (aesthetic polish): visual/contrast pass (Playwright) verifies the
  fridge/snowflake/random-food chrome that happy-dom cannot assert; consider surfacing the
  fridge toolbar even in the empty-pipeline state (archived-only-project edge above).
- **MR-7 is the LAST backend-touching slice** — MR-8 is frontend-only. `nw-finalize` (archive
  to `docs/evolution/`) runs after MR-8.
- **Deferred (c) — `distill/upstream-issues.md` UI-8:** org-configurable retention window
  needs the deferred functional org-settings surface (§3.3); 90d hardcoded for now.
