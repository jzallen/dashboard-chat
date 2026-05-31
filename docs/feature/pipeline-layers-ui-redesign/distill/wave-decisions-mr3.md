# DISTILL Wave Decisions — pipeline-layers-ui-redesign / MR-3

Slice: **MR-3 — breadcrumb navigation shell replacing the SideNav (org-icon toggle).**
Scope/decision source: `../path-forward.md` §4.1 (shell: breadcrumb replaces
sidebar), §4.2 (routes; org sheet as a `?org=1` overlay / search param), §5 MR-3.
DESIGN-equivalent SSOT — no `docs/product/` and no DISCUSS user-stories exist for
this feature (mirrors MR-1 DWD-6 / MR-2). MR-3 artifacts are namespaced `-mr3` so
the MR-1 / MR-2 DISTILL/DELIVER records are preserved unchanged.

Prior-wave reading (READING ENFORCEMENT):
- `+ docs/feature/pipeline-layers-ui-redesign/path-forward.md` (§4.1, §4.2, §5, §9)
- `+ docs/feature/pipeline-layers-ui-redesign/design-sources.md`
- `+ docs/feature/pipeline-layers-ui-redesign/deliver/wave-decisions.md` (MR-1)
- `+ docs/feature/pipeline-layers-ui-redesign/distill/wave-decisions-mr2.md`
- `+ docs/feature/pipeline-layers-ui-redesign/deliver/wave-decisions-mr2.md`
- `- docs/product/journeys/*.yaml` (not found — no DISCUSS for this feature)
- `- docs/product/architecture/brief.md` (not found — path-forward.md is the DESIGN SSOT)
- `- docs/product/kpi-contracts.yaml` (not found)
- `- docs/feature/pipeline-layers-ui-redesign/discuss/*` (not found)
- `- docs/feature/pipeline-layers-ui-redesign/devops/*` (not found — default env matrix N/A; pure-FE vitest slice)

Wave-decision reconciliation: **0 contradictions.** MR-1 delivered the token layer
(`frontend/app/theme/`) the breadcrumb chrome consumes; MR-2 delivered the Pipeline
landing (`projects/:projectId/pipeline`) the project picker navigates to. Both are
carry-forwards explicitly anticipated by MR-2 `deliver/wave-decisions-mr2.md`
("MR-3 (breadcrumb shell) can route into `projects/:projectId/pipeline`").

---

## DWD-M3-1 — Walking Skeleton Strategy: C (real local I/O), vitest-gated
**Decision:** Strategy C — frontend-only, no backend/external/costly deps. The only
ports MR-3 touches are the **dataCatalog REST hooks** (the data port) and the
**rendered breadcrumb route surface** (the driving port). The acceptance gate is the
**vitest** suite (`happy-dom`), NOT a pytest acceptance suite — none exists for this
feature and none was created (mirrors MR-1 DWD-D1 / MR-2 DWD-M2-1). The
walking-skeleton thin slice is the project-picker scenario
(`Breadcrumb.test.tsx > "filters projects by name and navigates to the selected
project's pipeline landing"`) — a real route-param → real query-hook port (doubled
at the boundary) → real `createRoutesStub` navigation to the MR-2 landing. Pre-baked
per the headless run brief; not gated on an interactive WS confirmation.

## DWD-M3-2 — Breadcrumb replaces SideNav in AppShell; org sheet is a `?org=1` overlay
**Decision:** AppShell swaps `<SideNav>` + `<UnifiedNav>` for a transparent floating
`<Breadcrumb>` over the centered content (path-forward §4.1). The org Settings sheet
is modelled as a **linkable `?org=1` search param** (path-forward §4.2), NOT a new
top-level route — AppShell renders `<OrgSheet>` over a darker inset backdrop iff the
param is present; the breadcrumb's org icon toggles the param and morphs to an ×.
**Superseded-code deletion (NOT an Iron-Rule violation):** `SideNav/` (the whole
self-contained directory — `index.tsx`, `UnifiedNav.tsx`, `ProjectNav.tsx`,
`ProjectNavItem.tsx`, `DatasetNavItem.tsx`, `SideNav.module.css`) and
`SideNav/__tests__/UnifiedNav.test.tsx` are deleted in DELIVER because the breadcrumb
supersedes them. The `SideNav/` directory is consumed ONLY by `AppShell` (verified by
grep) — no other importer is stranded.

## DWD-M3-3 — happy-dom limitation: assert STRUCTURE, not computed colors
**Decision:** happy-dom does **not** apply stylesheets, so the breadcrumb tests assert
testids, crumb text, picker grouping/filtering, navigation (via `createRoutesStub`),
and the org-toggle/× morph + affordance-hiding — **never** computed colors or the MR-1
token values. Visual/contrast verification of the breadcrumb chrome is deferred to the
MR-8 Playwright/visual pass (mirrors MR-1 DWD-D3 / MR-2 DWD-M2-3).

## DWD-M3-4 — Anti-strand scoping call: a minimal utility menu until MR-4
**Decision (deliberate, per the brief's SEQUENCING CARE):** the breadcrumb owns
**org / project / model** navigation only. The SideNav also exposed **New Session**,
**Recent chats / All Chats (`/sessions`)**, and **Query Engines (`/query-engines`)**.
Per the design those session controls move into the assistant overlay — but that is
**MR-4, not built yet**. To avoid stranding those routes, MR-3 adds a **minimal
utility menu** in the breadcrumb (`breadcrumb-utility` → `utility-new-session`,
`utility-sessions` → `/sessions`, `utility-query-engines` → `/query-engines`) as an
**interim affordance**. The routes themselves stay registered and directly reachable
(`routes.ts` untouched for `sessions` / `query-engines`); `root.test.tsx` welcome
panel + SSR tests stay green. MR-4 removes the interim menu when the assistant overlay
absorbs the session controls. This is the documented choice the brief required.

## DWD-M3-5 — Active-project resolution on model routes (no projectId param)
**Decision:** model-detail routes (`view/:viewId`, `report/:reportId`,
`table/:datasetId`) carry the model id but NOT a `projectId` param. The breadcrumb
resolves the active project as `params.projectId ?? model.project_id`, reading
`project_id` from the relevant detail hook (`useViewQuery` / `useReportQuery` /
`useDatasetQuery`, each gated by its id's presence). `View` / `Report` / full
`Dataset` all carry `project_id` (verified in `core/dataCatalog/*.ts`). This keeps the
"Project (plain link back)" crumb correct on model views without a projectId in the
URL, and feeds the model picker the right per-project model lists.

## DWD-M3-6 — Picker data from dataCatalog hooks; the ui-state wire is NOT touched
**Decision:** project picker = `useOrgProjectsQuery` (`listProjects`); model picker =
`useDatasets` / `useViewsQuery` / `useReportsQuery` (`listDatasets`/`listViews`/
`listReports`). All are the existing dataCatalog TanStack Query hooks. **No
`@dashboard-chat/ui-state-wire` / `lib/ui-state-client` import** is added by MR-3
(saved-feedback constraint — the ui-state transport is in flux and stays untouched).

## DWD-M3-7 — Mandate 7 scaffolding (TypeScript), pure-core placement, verified RED
**Decision:** RED-ready scaffolds, each marked `__SCAFFOLD__`, bodies
`throw new Error("Not yet implemented — RED scaffold (breadcrumb MR-3)")`:
- `frontend/src/ui/components/Breadcrumb/breadcrumbContext.ts` — **pure core**
  (framework-free; no React/react-router import) so the route→context mapping is
  unit-testable in isolation.
- `frontend/src/ui/components/Breadcrumb/{index,ProjectPicker,ModelPicker}.tsx`
  + `Breadcrumb.module.css` (real CSS consuming MR-1 tokens — CSS cannot scaffold-throw).
- `frontend/src/ui/components/OrgView/OrgSheet.tsx`.
**Verified RED (not BROKEN):** all **22** vitest cases fail with the scaffold marker,
zero import/resolve errors (`npx vitest run src/ui/components/Breadcrumb
src/ui/components/OrgView/OrgSheet.test.tsx src/ui/components/AppShell/AppShell.test.tsx`).
DELIVER replaces the bodies (GREEN) and removes the markers (grep → empty at done).
`AppShell/index.tsx` is an existing file (no scaffold); `AppShell.test.tsx` is RED now
because the current shell renders `unified-nav` and no `breadcrumb` — the swap turns it
GREEN.

## DWD-M3-8 — Test-boundary decisions (port-to-port, isolation)
- **Driving port:** the rendered breadcrumb route surface, exercised through
  `createRoutesStub` at real paths (`/projects/p1/pipeline`, `/view/v1`,
  `/projects/p1/pipeline?org=1`). Picker selection asserts **real navigation** (the
  destination re-renders the breadcrumb in the new context — e.g. project-crumb flips
  `Alpha`→`Beta`, model-crumb flips `int_revenue`→`fct_sales`), not a spy call — this
  proves the param wiring + navigation, not merely that a component renders (RCA P1
  driving-adapter mandate, adapted to the FE route surface).
- **Data port (driven):** the dataCatalog query hooks, doubled at the boundary
  (mirrors `PipelineLanding.test`). No new driven adapter with real network I/O is
  introduced (the REST client already has its own contract tests under
  `src/core/dataCatalog/__tests__/`), so no `@real-io @adapter-integration` HTTP
  scenario is added here (mirrors MR-2 DWD-M2-7).
- **Pickers tested via the breadcrumb, not standalone:** `ProjectPicker` / `ModelPicker`
  are sub-components of the breadcrumb; their search + select behavior is exercised
  through `Breadcrumb.test.tsx` (open → search-filter → select → navigate), which is
  the user-facing path. No standalone picker test files.
- **AppShell glue tested with the breadcrumb + sheet stubbed:** `AppShell.test.tsx`
  stubs `../Breadcrumb` and `../OrgView/OrgSheet` and doubles the providers/guards/
  hooks, asserting the swap (renders `breadcrumb`, never `unified-nav`, renders the
  Outlet) and the `?org=1` → `org-sheet` decision. The sheet's own content is covered
  by `OrgSheet.test.tsx`. This keeps the heavy shell wiring as thin, verifiable glue.

## DWD-M3-9 — Model-picker navigation targets
**Decision:** dataset → `/table/:datasetId` (the canonical single-dataset detail route,
param-name `datasetId`), view → `/view/:viewId`, report → `/report/:reportId`. All
three are existing registered routes; the dataset target uses the param-free
`table/:datasetId` form so the picker needs no projectId. The breadcrumb model-context
detection keys off the same params (`datasetId` / `viewId` / `reportId`).

## DWD-M3-10 — Single Neobrutalist + Solarized `.dark`; no aesthetic switcher
**Decision:** the breadcrumb + org sheet consume the MR-1 `--color-*` / `--border-*` /
`--radius` / `--shadow` tokens via the CSS module; no `.theme-*` aesthetic selector is
added (path-forward §9 — Option A locked). The only appearance control remains the
dark-mode `ThemeToggle`, now also reachable inside the org sheet's Appearance section.

---

## Adapter coverage table (Mandate 6)
| Adapter | @real-io scenario | Covered by |
|---------|-------------------|------------|
| dataCatalog REST hooks (project/model lists, model detail) | N/A — pre-existing client; contract-tested under `src/core/dataCatalog/__tests__/` | doubled at the port in `Breadcrumb.test` (mirrors MR-2) |

No new driven adapter with real network I/O is introduced by MR-3 → no
`NO — MISSING` rows.

## Self-review checklist
- [x] WS strategy declared (DWD-M3-1).
- [x] Gate is vitest (`happy-dom`); structure/navigation asserted, not colors (DWD-M3-3).
- [x] No new driven adapter → no missing @real-io scenario (table above).
- [x] InMemory/double limits documented: happy-dom can't model CSS cascade/computed
      tokens/paint; the route doubles can't model real network latency/errors.
- [x] Mandate 7: every imported production module has a `__SCAFFOLD__` stub; bodies
      throw `Error` (RED, not `NotImplementedError`/ImportError); **22/22 verified RED**.
- [x] No `__SCAFFOLD__` expected to remain after DELIVER (grep gate in roadmap).
- [x] Error/edge coverage ≥ 40%: of 22 cases, the non-happy-path / branch coverage —
      no-model crumb absence, model-route project-from-model_id resolution, search
      filter exclusions (p1 hidden / d1+v1 hidden), org-open affordance hiding +
      linkable-param derivation, anti-strand utility routes, sheet backdrop/close/
      select — comfortably exceeds 40%.
