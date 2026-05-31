# DELIVER Wave Decisions — pipeline-layers-ui-redesign / MR-2

Slice: MR-2 — lineage Pipeline view (Flow / Lanes / Audit) + project landing route.
Roadmap: `../distill/roadmap-mr2.json` (3 steps). DES record (this slice):
`deliver/mr2/{roadmap.json, execution-log.json}`.

Commits (atomic, sequential):
- `366f508` — `feat(frontend): add pure lineage graph builder (MR-2 step 02-01)` (Step-ID 02-01)
- `86d4bea` — `feat(frontend): add lineage Flow/Lanes/Audit views + style switch (MR-2 step 02-02)` (Step-ID 02-02)
- `c15c562` — `feat(frontend): add Pipeline project-landing route (MR-2 step 02-03)` (Step-ID 02-03)
- (RED + docs landed earlier: `3a0ba6c` test suite, `06ec9e4` DISTILL artifacts.)

## Outcome
- **All 3 steps COMMIT/PASS.** Each ran the 5 DES TDD phases (PREPARE/RED_ACCEPTANCE/RED_UNIT/GREEN/COMMIT); `verify_deliver_integrity docs/feature/pipeline-layers-ui-redesign/deliver/mr2/` → "All 3 steps have complete DES traces" (15 events).
- **Acceptance gate GREEN:** 30/30 MR-2 vitest cases (14 buildGraph + 13 views/canvas + 3 landing). **Full frontend suite 678/678** (76 files). Zero `__SCAFFOLD__` markers remain across `frontend/src/core/lineage`, `frontend/src/ui/components/Pipeline`, `frontend/app/routes/pipeline.tsx`.
- **Sequential dispatch honored:** one crafter step at a time; each verified (its scenarios green, full suite green, commit scope correct, no testing-theater) before the next, per saved-feedback.
- **Adversarial review (Phase 4): APPROVE** (nw-software-crafter-reviewer) — **zero blocking, zero non-blocking** findings. Confirmed buildGraph correctness (layers, live edges, dedup, orphan incl. archived/no-ref cases, empty-safety), port discipline (no ui-state-wire import; data via dataCatalog hooks only), MR-1 token compliance (no hardcoded palette), strictly additive scope, and meaningful (non-theater) tests.
- **DISTILL gate (Phase prior): APPROVE** (nw-acceptance-designer-reviewer) — 0 blockers, ~50% edge coverage.

## Adaptations from the standard nw-deliver flow (per-MR frontend slice)
- **DWD-M2-D1 — Acceptance gate is vitest, not a Python suite.** No pytest acceptance suite exists or was created for MR-2 (mirrors MR-1 DWD-D1). Phase-3.5's `pytest tests/acceptance/{feature}` substituted by the vitest suite + full-suite green gate.
- **DWD-M2-D2 — Phase-3.5 Elevator-Pitch demo gate: N/A.** No DISCUSS user-stories exist for this feature, so there is no `After: run … → sees …` line to execute (mirrors MR-1 DWD-D2). Skipped (not applicable), not bypassed.
- **DWD-M2-D3 — Phase 3 dedicated refactor pass skipped.** The adversarial reviewer confirmed the diff clean at L1–L4 (single-responsibility builder + three small presentational views, no duplication worth extracting, no dead code). A separate RPP pass adds no value (mirrors MR-1 DWD-D3).
- **DWD-M2-D4 — Phase 5 mutation testing skipped.** The slice is a pure builder + presentational views whose behavior is fully pinned by the 30 example tests (incl. the orphan/edge branches). Mutation on this surface is low-value; logged skip (mirrors MR-1 DWD-D4).
- **DWD-M2-D5 — Phase 7 finalize DEFERRED.** `nw-finalize` archives a *completed* feature to `docs/evolution/`. MR-2 is 2 of 8; finalize runs after MR-8. MR-2 lands incrementally via `gt mq submit` (CLAUDE.md trunk-based workflow).
- **DWD-M2-D6 — DES log path quirk + committed location.** The DES stop-hook derives the execution-log path from the `DES-PROJECT-ID` marker (`docs/feature/{id}/deliver/`), so with `DES-PROJECT-ID=pipeline-layers-ui-redesign-mr2` the live trace was written under a transient `docs/feature/pipeline-layers-ui-redesign-mr2/deliver/`. To keep the committed record under the real feature folder (and not clobber MR-1's `deliver/execution-log.json`), the authoritative log + roadmap were consolidated into **`deliver/mr2/`** and the transient top-level dir removed (not committed). Integrity re-verified at the committed location.
- **DWD-M2-D7 — Orchestrator NUL-byte fix on step 02-01.** The crafter's first 02-01 implementation used a literal control byte (`\x00`) as the edge-dedup key separator, which flipped the file to git-binary. The orchestrator replaced it with a collision-safe `JSON.stringify([ref.id, nodeId])` key and amended the (un-pushed) commit; 14/14 still green, file is proper UTF-8 text. No behavioral change.

## Design / scope adherence
- **ui-state wire untouched** — the lineage graph is derived from the dataCatalog REST hooks (`useDatasets`/`useViewsQuery`/`useReportsQuery`); no `@dashboard-chat/ui-state-wire` / `lib/ui-state-client` import in the Pipeline feature (saved-feedback constraint).
- **Single Neobrutalist + Solarized `.dark`** — views consume the MR-1 `--layer-*` / `--color-*` / `--shadow` tokens; no aesthetic switcher added.
- **Additive landing** — `projects/:projectId/pipeline` is new; the chat `/` index, `root.tsx` `no_projects` welcome panel, and all existing detail/sessions/chat routes are untouched. Full `/`-index swap + chat-as-overlay remain MR-4 (DWD-M2-2).
- **No backend change.** Orphan detection is derived in the builder; archived set is empty for MR-2 (cold storage = MR-7), but the builder supports a non-empty set so MR-7 wires live archive state with no builder change.

## Carry-forward
- **MR-3** (breadcrumb shell) can route into `projects/:projectId/pipeline` as the project landing.
- **MR-4** swaps the `/` index to Pipeline + introduces the chat-as-overlay; revisit whether `projects/:projectId/pipeline` collapses into the index then.
- **MR-6** adds first-class upload "source" nodes → buildGraph gains source-layer nodes + source→dataset edges (the `source` layer + ordering are already reserved).
- **MR-7** wires live archive state into the (already-supported) `archived` set; the FlowView-disabled / Lanes-"Orphaned" treatments already render archived-driven orphans.
- **MR-5** replaces AuditView's derived dependency summary with the rich Assistant-changes provenance panel (may need a backend read endpoint — path-forward §2.5 open-question 5).
- **MR-8** visual/contrast pass (Playwright) verifies the `--layer-*` accent colors that happy-dom cannot assert (DWD-M2-3).
