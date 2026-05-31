# DELIVER Wave Decisions — pipeline-layers-ui-redesign / MR-5

Slice: MR-5 — Single-page model-detail recomposition (dependency strip +
Assistant-changes audit + data preview + columns/measures + compiled SQL) across the
dataset (`/table/:id` → TableView), view (`/view/:id` → ViewDetailView), and report
(`/report/:id` → ReportDetailView) detail surfaces.
Roadmap: `../distill/roadmap-mr5.json` (3 steps). DES record (this slice):
`deliver/mr5/{roadmap.json, execution-log.json}`.

Commits (atomic, sequential):
- `381eaeb` — `test(frontend): RED suite + scaffolds for MR-5 model-detail recomposition` (DISTILL RED + scaffolds + detail-view test re-specs)
- `871242c` — `docs(pipeline-ui-redesign): DISTILL artifacts for MR-5 (roadmap, walking-skeleton, wave-decisions)`
- `ed96cd8` — `feat(frontend): shared ModelDetail primitives for single-page model detail (MR-5 step 05-01)` (Step-ID 05-01)
- `d6e1d33` — `feat(frontend): recompose View + Report detail onto single-page model layout (MR-5 step 05-02)` (Step-ID 05-02)
- `edbef6c` — `feat(frontend): recompose dataset detail (TableView) onto single-page model layout (MR-5 step 05-03)` (Step-ID 05-03)

## Outcome
- **All 3 steps COMMIT/PASS.** Each ran the DES TDD phases (PREPARE / RED_ACCEPTANCE /
  [RED_UNIT SKIPPED] / GREEN / COMMIT); `verify_deliver_integrity` over
  `deliver/mr5/execution-log.json` → "All 3 steps have complete DES traces" (PASS). The
  committed DES record lives at `deliver/mr5/` directly (driven inline — no transient
  `pipeline-layers-ui-redesign-mr5/` dir was created; see DWD-M5-D6).
- **Acceptance gate GREEN:** the MR-5 vitest cases — step 05-01 28 (deps 5 +
  assistantChanges 4 + useModelDependencies 2 + DependencyStrip 6 + AssistantChangesPanel
  2 + DataPreviewGrid 4 + CompiledSqlPanel 3 + DatasetColumnsTable 2), step 05-02 30
  (ViewDetailView 12 + ReportDetailView 12 + ReportDetailView.integration 6), step 05-03
  14 (TableView.detail 8 + TableView/ActivityLog 6). **Full frontend suite 743/743 across
  90 files** (up from 704 at MR-4). Zero `__SCAFFOLD__` markers remain under `src/`.
- **Sequential dispatch honored:** one crafter step at a time; each verified (its
  scenarios green, no testing-theater, commit scope correct, no scaffold left, no
  previously-passing test regressed) before the next, per saved-feedback. The
  DISTILL-authored re-spec RED for the detail views (05-02/05-03) stayed RED until its step.
- **Adversarial review (Phase 4): APPROVE, no defects.** `nw-software-crafter-reviewer`
  confirmed across 8 dimensions: ui-state wire untouched (no `@dashboard-chat/ui-state-wire`
  / `lib/ui-state-client` import; no new chat/stream client; no backend endpoint); all
  preserved chat affordances intact (setContext mount/unmount, tool-handler
  register/unregister, ChatInput, ActivityLog, report layerContext, dataset
  registerTableApi/registerTableSchema/table-state cache/useTransforms); correct deps
  derivation direction + dedup + order; correct deriveAssistantChanges incl. bad-JSON
  fallback; hooks called unconditionally before early returns; no react-router-dom hazard;
  no testing-theater/TBU; deferred (c) honestly marked. No revision required.
- **DISTILL gate (prior): APPROVE** (nw-acceptance-designer-reviewer) — 0 blockers.

## Design / scope adherence
- **Reuse-and-recompose, not rewrite (DWD-M5-3).** The three detail views now render via a
  shared `ModelDetailLayout` and the shared sections (DependencyStrip, AssistantChangesPanel,
  DataPreviewGrid, CompiledSqlPanel, DatasetColumnsTable). Model data comes from the EXISTING
  dataCatalog TanStack Query hooks; the dependency strip reuses the EXISTING MR-2 `buildGraph`
  via the new pure `deriveModelDependencies` + thin `useModelDependencies` hook. No ui-state
  wire / chat transport / agent contract touch; NO backend endpoint added (the redesign's two
  backend touches stay reserved for MR-6/MR-7).
- **Dependency strip (DWD-M5-4)** shows upstream producers + downstream consumers, links by
  kind to the MR-2 detail routes (`/table/:id`, `/view/:id`, `/report/:id`); the
  `@walking_skeleton` case proves a real link navigates (createRoutesStub, destination render).
- **Assistant-changes audit (DWD-M5-5, deferred-c logged):** fed by the live chat session's
  assistant tool-calls (`deriveAssistantChanges(useChatContext().messages)`) with an explicit
  empty-state. The persisted cross-session per-model feed is a deferred (c) — `upstream-issues.md`
  UI-5 (needs a new backend read endpoint; not in MR-5).
- **Data preview (DWD-M5-6, deferred-c logged):** dataset ships the existing interactive
  `TablePanel` as its preview; view/report render the documented "preview not yet available"
  empty-state — deferred (c), `upstream-issues.md` UI-6 (needs query-engine sampling).
- **Compiled SQL:** `CompiledSqlPanel` over `Dataset.staging_sql` / `View.sql_definition` /
  `Report.sql_definition` (the ref()-wired compiled SQL), collapsible.
- **Columns/measures:** dataset → new `DatasetColumnsTable` (schema_config); view → retained
  `ViewSchemaTable`; report → retained `ColumnsMetadataTable`.
- **Open questions held at default:** view editing stays chat-driven (no inline join/grain
  editor — q2); reports stay plain aggregation SQL (no dbt semantic-model surface — q1); the
  existing models carry no such data, so nothing was surfaced.
- **Single Neobrutalist + Solarized `.dark` (DWD-M5-10):** `ModelDetail.module.css` consumes
  the MR-1 tokens; no aesthetic switcher. Visual/contrast fidelity deferred to MR-8 (happy-dom
  can't assert computed styles — DWD-M5-2).

## Adaptations from the standard nw-deliver flow (per-MR frontend slice)
- **DWD-M5-D1 — Acceptance gate is vitest, not a Python suite.** No pytest acceptance suite
  exists or was created for MR-5 (mirrors MR-1..MR-4). Phase-3.5's `pytest tests/acceptance/{feature}`
  substituted by the vitest suite + full-suite green gate.
- **DWD-M5-D2 — Phase-3.5 Elevator-Pitch demo gate: N/A.** No DISCUSS user-stories exist for
  this feature, so there is no `After: run … → sees …` line to execute. Skipped (not applicable),
  not bypassed.
- **DWD-M5-D3 — Phase 3 dedicated refactor pass skipped.** The adversarial reviewer confirmed
  the diff clean at L1–L2 (small pure helpers + presentational sections + a shared layout;
  the chat affordances reused verbatim; no duplication worth extracting, no dead code). A
  separate RPP pass adds no value (mirrors MR-1..MR-4).
- **DWD-M5-D4 — Phase 5 mutation testing skipped.** The slice is pure derivation helpers +
  presentational recomposition whose behavior is fully pinned by the example cases (deps
  direction/dedup/order, audit mapping + bad-JSON fallback, preview/SQL/columns states +
  empty-states, navigation, preserved chat wiring). Mutation on this surface is low-value;
  logged skip (mirrors MR-1..MR-4).
- **DWD-M5-D5 — Phase 7 finalize DEFERRED.** `nw-finalize` archives a *completed* feature to
  `docs/evolution/`. MR-5 is 5 of 8; finalize runs after MR-8. MR-5 lands incrementally via
  `gt mq submit`. No deliver-session marker was created (steps driven inline with manual
  `log_phase` instrumentation), so none needed cleanup.
- **DWD-M5-D6 — DES log path: driven inline, committed directly under `deliver/mr5/`.** Unlike
  MR-4 (which dispatched crafter subagents and hit the stop-hook's `DES-PROJECT-ID`-derived
  transient path), MR-5's three steps were driven inline by the DELIVER orchestrator with
  manual `init_log` / `log_phase` / `verify_deliver_integrity`. The record was written directly
  to `deliver/mr5/{roadmap.json,execution-log.json}` — no transient `pipeline-layers-ui-redesign-mr5/`
  dir was created or needed removal. Integrity verified at the committed location (PASS).
- **DWD-M5-D7 — RED_UNIT logged SKIPPED across all three steps.** The DISTILL example cases
  ARE the unit/acceptance spec for this slice; the shared primitives carry their own
  fine-grained unit suites (05-01). Each step logged `RED_UNIT SKIPPED NOT_APPLICABLE`
  (mirrors the MR-2/3/4 pattern).
- **DWD-M5-D8 — ReportDetailView.integration.test re-mock (test-infra, not weakening).** The
  recomposition added a `useModelDependencies` call to ReportDetailView, which pulls
  `useReportsQuery` from the `useReportQuery` module; the pre-existing tool-call integration
  test mocked that module without the new export. A `useModelDependencies` double (and a
  `useReportsQuery` stub) was added to that test — it asserts tool-call flow, NOT detail markup,
  so its assertions are unchanged. Anticipated by DWD-M5-7; not an Iron-Rule violation.

## Known non-blocking nit (deferred)
- The Neobrutalist light skin and the Solarized `.dark` skin of the model-detail chrome differ
  only at the token/CSS layer, asserted by neither happy-dom test (DWD-M5-2). Visual fidelity
  is deferred to the MR-8 Playwright/visual pass, as planned.

## Carry-forward
- **MR-6** (upload modal + source display_name) and **MR-7** (cold storage / retention) carry
  the redesign's only backend touches. MR-7's archive state feeds the lineage builder MR-5's
  dependency strip already consumes — when archive lands, archived nodes drop out of the strip
  automatically (buildGraph filters non-live inputs).
- **Deferred (c) — `upstream-issues.md`:** UI-5 (persisted per-model Assistant-changes audit
  feed — needs a backend read endpoint) and UI-6 (view/report data preview — needs query-engine
  sampling). Both render documented empty-states / live-session shells in MR-5; revisit when a
  backend surface is in scope.
- **MR-8** visual/contrast pass (Playwright) verifies the model-detail chrome that happy-dom
  cannot assert.
