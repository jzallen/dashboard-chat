# DELIVER Wave Decisions — pipeline-layers-ui-redesign / MR-3

Slice: MR-3 — breadcrumb navigation shell replacing the SideNav (org-icon toggle).
Roadmap: `../distill/roadmap-mr3.json` (4 steps). DES record (this slice):
`deliver/mr3/{roadmap.json, execution-log.json}`.

Commits (atomic, sequential):
- `ed63282` — `feat(frontend): implement breadcrumb route-context resolver (MR-3 step 03-01)` (Step-ID 03-01)
- `f55fae9` — `feat(frontend): add breadcrumb nav shell + pickers + org toggle (MR-3 step 03-02)` (Step-ID 03-02)
- `53fa47d` — `feat(frontend): add org settings sheet overlay (MR-3 step 03-03)` (Step-ID 03-03)
- `80980d2` — `feat(frontend): replace SideNav with breadcrumb shell + org sheet (MR-3 step 03-04)` (Step-ID 03-04)
- `968d0b5` — `refactor(frontend): migrate org-view project cards to MR-1 tokens (MR-3 review revision)` (Step-ID 03-04 — the one allowed adversarial-review revision)
- (RED + DISTILL docs landed earlier: `34d9904` RED suite + scaffolds, `fde5486` DISTILL artifacts.)

## Outcome
- **All 4 steps COMMIT/PASS.** Each ran the DES TDD phases (PREPARE/RED_ACCEPTANCE/[RED_UNIT SKIPPED]/GREEN/COMMIT); `verify_deliver_integrity docs/feature/pipeline-layers-ui-redesign-mr3/deliver/` → "All 4 steps have complete DES traces" (exit 0). The committed DES record was consolidated into `deliver/mr3/` (DWD-M2-D6 path quirk — see below).
- **Acceptance gate GREEN:** 22/22 MR-3 vitest cases (6 resolver + 9 breadcrumb + 4 org-sheet + 3 app-shell). **Full frontend suite 692/692** (79 files; down from 700/80 because the superseded `SideNav/__tests__/UnifiedNav.test.tsx`, 8 cases, was deleted with the SideNav). Zero `__SCAFFOLD__` markers remain under `frontend/src/ui/components/Breadcrumb` or `OrgView/OrgSheet.tsx`.
- **Superseded code deleted (NOT an Iron-Rule violation):** the whole `frontend/src/ui/components/SideNav/` directory (index, UnifiedNav, ProjectNav, ProjectNavItem, DatasetNavItem, SideNav.module.css) + `__tests__/UnifiedNav.test.tsx` removed in step 03-04. `grep -rn "SideNav\|UnifiedNav" frontend/src frontend/app` → only historical prose in test/comment strings; **zero live importers**. `routes.ts` untouched — `/sessions` and `/query-engines` stay registered and reachable via the breadcrumb's interim utility menu (no stranded routes).
- **Sequential dispatch honored:** one crafter step at a time; each verified (its scenarios green, full suite green, commit scope correct, no testing-theater, no scaffold left) before the next, per saved-feedback.
- **Adversarial review (Phase 4): REQUEST_CHANGES → one revision applied → resolved.** `nw-software-crafter-reviewer` rated test quality EXCELLENT (no Testing-Theater; real route surface via `createRoutesStub`; navigation asserted by destination re-render; ui-state wire untouched; routes intact) and raised **one blocker**: the org sheet's project cards used a hardcoded palette (`bg-white`/`text-gray-*`) and would not reskin under Solarized dark. Fixed in `968d0b5` by migrating the `.card*` / `.emptyState` styles in `OrgView.module.css` to the MR-1 tokens. Per the brief's exit criteria ("APPROVE or one revision applied"), the single CSS revision closes the blocker; the suite stayed green (CSS-only, happy-dom asserts no colors).
- **DISTILL gate (prior): APPROVE** (nw-acceptance-designer-reviewer) — 0 blockers, ~55% edge coverage.

## Adaptations from the standard nw-deliver flow (per-MR frontend slice)
- **DWD-M3-D1 — Acceptance gate is vitest, not a Python suite.** No pytest acceptance suite exists or was created for MR-3 (mirrors MR-1 DWD-D1 / MR-2 DWD-M2-D1). Phase-3.5's `pytest tests/acceptance/{feature}` substituted by the vitest suite + full-suite green gate.
- **DWD-M3-D2 — Phase-3.5 Elevator-Pitch demo gate: N/A.** No DISCUSS user-stories exist for this feature, so there is no `After: run … → sees …` line to execute (mirrors MR-1/MR-2). Skipped (not applicable), not bypassed.
- **DWD-M3-D3 — Phase 3 dedicated refactor pass skipped.** The adversarial reviewer confirmed the diff clean at L1–L4 (pure resolver + small presentational pickers + thin shell swap; no duplication worth extracting, no dead code). The one finding was a CSS-token gap, fixed directly. A separate RPP pass adds no value (mirrors MR-1/MR-2).
- **DWD-M3-D4 — Phase 5 mutation testing skipped.** The slice is a pure resolver + presentational components whose behavior is fully pinned by the 22 example tests (incl. context branches, picker filtering, org-toggle param derivation, navigation targets). Mutation on this surface is low-value; logged skip (mirrors MR-1/MR-2).
- **DWD-M3-D5 — Phase 7 finalize DEFERRED.** `nw-finalize` archives a *completed* feature to `docs/evolution/`. MR-3 is 3 of 8; finalize runs after MR-8. MR-3 lands incrementally via `gt mq submit` (CLAUDE.md trunk-based workflow). The deliver-session marker was cleaned (`.nwave/des/deliver-session.json` removed) without running finalize.
- **DWD-M3-D6 — DES log path quirk + committed location.** DES derives the log path from `DES-PROJECT-ID`; with `DES-PROJECT-ID=pipeline-layers-ui-redesign-mr3` the live trace was written under a transient `docs/feature/pipeline-layers-ui-redesign-mr3/deliver/`. To keep the committed record under the real feature folder (and not clobber MR-1/MR-2 records), the authoritative log + roadmap were consolidated into **`deliver/mr3/`** and the transient top-level dir removed (not committed). Integrity verified before consolidation (exit 0).
- **DWD-M3-D7 — RED_UNIT logged SKIPPED across all four steps.** The DISTILL-authored example cases ARE the unit/acceptance spec for this presentational slice; no additional internal seam warranted a separate micro-test. Each step logged `RED_UNIT SKIPPED NOT_APPLICABLE` (mirrors the MR-2 pattern).

## Design / scope adherence
- **ui-state wire untouched** — picker data is read from the dataCatalog query hooks (`useOrgProjectsQuery`, `useDatasets`/`useViewsQuery`/`useReportsQuery`, `useViewQuery`/`useReportQuery`/`useDatasetQuery`); no `@dashboard-chat/ui-state-wire` / `lib/ui-state-client` import added anywhere in the MR-3 diff (saved-feedback constraint).
- **Single Neobrutalist + Solarized `.dark`** — the breadcrumb, pickers, and org sheet (incl. the now-migrated project cards) consume the MR-1 `--color-*` / `--border-width` / `--radius` / `--shadow` tokens; no aesthetic switcher added (path-forward §9, DWD-M3-10).
- **Org sheet as `?org=1` overlay, not a route** — the org icon toggles a linkable `?org=1` search param (via `useSearchParams`), morphs to `×`, and hides project/model crumbs while open; AppShell renders `<OrgSheet>` over a darker inset backdrop only when the param is present, with `onClose` clearing it (path-forward §4.2, DWD-M3-2).
- **Anti-strand utility menu** — the interim `breadcrumb-utility` menu (New Session / All Chats → /sessions / Query Engines → /query-engines) keeps those routes reachable until MR-4 moves session controls into the assistant overlay (DWD-M3-4). The routes themselves were not modified.
- **Additive resolver, model-route project resolution** — `resolveBreadcrumbContext` is a framework-free pure core (hexagonal); on model routes the active project is `params.projectId ?? model.project_id` read from the matching detail hook (DWD-M3-5).
- **No backend change.** Pure-frontend slice.

## Known non-blocking nit (deferred)
- `OrgSheet` accepts an `orgName` prop it does not yet render — an intentional display-only placeholder for the future org-name header (path-forward §3.3 keeps org settings display-only for this redesign). The reviewer agreed it is acceptable, not a defect; the AppShell wiring already passes `orgName` so wiring it to a visible header later is a one-line change. Left as-is.

## Carry-forward
- **MR-4** swaps the `/` index to Pipeline + introduces the chat-as-overlay (assistant FAB), which ABSORBS the breadcrumb's interim utility menu (New Session / Recents / All Chats) — remove `breadcrumb-utility` then and route session controls through the overlay.
- **MR-5** (model detail recomposition) lands on the same `view/:id` / `report/:id` / `table/:id` routes the model picker navigates to.
- **MR-8** visual/contrast pass (Playwright) verifies the breadcrumb + org-sheet token colors that happy-dom cannot assert (DWD-M3-3), and continues migrating remaining lower-traffic components (path-forward §4.3).
