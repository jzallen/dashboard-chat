# DISTILL Wave Decisions — pipeline-layers-ui-redesign / MR-2

Slice: **MR-2 — lineage Pipeline view (Flow / Lanes / Audit) + landing swap.**
Scope/decision source: `../path-forward.md` §2.1 (lineage feature), §4.2 (routes /
landing), §4.5 (lineage feature module), §5 (MR-2). DESIGN-equivalent SSOT —
no `docs/product/` and no DISCUSS user-stories exist for this feature (mirrors
MR-1 DWD-6). MR-2 artifacts are namespaced `-mr2` so the MR-1 DISTILL/DELIVER
records are preserved unchanged.

Prior-wave reconciliation: read MR-1 `distill/wave-decisions.md` +
`deliver/wave-decisions.md`; **0 contradictions** with MR-2. MR-1 delivered the
token layer (`frontend/app/theme/`) that MR-2 consumes via the layer-accent
custom properties.

---

## DWD-M2-1 — Walking Skeleton Strategy: C (real local I/O), vitest-gated
**Decision:** Strategy C — frontend-only, no backend/external/costly deps. The
only ports MR-2 touches are the **dataCatalog REST hooks** (the data port) and the
**rendered route surface** (the driving port). The acceptance gate is the
**vitest** suite (`happy-dom`), NOT a pytest acceptance suite — there is no Python
acceptance suite for MR-2 and none was created (mirrors MR-1 DWD-1/DWD-2). The
walking-skeleton thin slice is the project-landing scenario
(`PipelineLanding.test.tsx > "renders the pipeline canvas with a node per catalog
item for the active project"`) — a real route-param → real query-hook port → real
rendered canvas path with the hooks doubled at the port boundary.
Pre-baked per the headless run brief; not gated on an interactive WS confirmation.

## DWD-M2-2 — Pipeline is a NEW project landing route, not an `/`-index swap
**Decision:** MR-2 registers `projects/:projectId/pipeline` →
`routes/pipeline.tsx` (default-exports `PipelineLanding`) as the lineage landing
surface for a selected project (path-forward §4.2). It is **additive**: the chat
`/` index (`routes/chat.tsx`), the `root.tsx` `no_projects` welcome panel, and all
existing detail/sessions/chat routes are **untouched**.
**Why not swap the `/` index to Pipeline now:** path-forward §4.2 ultimately wants
`/` = Pipeline with chat-as-overlay, but **chat-as-overlay is MR-4**. Removing chat
from `/` before the overlay exists would strand the chat surface and risk the
`root.test.tsx` welcome-panel + SSR tests (the brief's explicit guard). Adding a
dedicated project-landing route realises "Pipeline as the project landing" without
that blast radius. The full `/`-index swap rides with MR-4.
**SSR loader deferred:** the route is library-mode (no `loader`). The graph is
derived client-side from the dataCatalog hooks; an SSR loader would require
server-side dataCatalog fetching and is out of MR-2 scope. Critically, deriving
client-side keeps MR-2 off the **ui-state wire** (saved-feedback constraint — the
ui-state transport is in flux and must stay untouched). routes.ts already documents
that routes stay library-mode unless they need SSR.

## DWD-M2-3 — happy-dom limitation: assert STRUCTURE, not computed colors
**Decision:** happy-dom does **not** apply stylesheets, so the view tests assert
testids, layer grouping/ordering, edge presence, the per-view orphan treatment, and
the style-switch behaviour — **never** computed colors or the MR-1 layer-accent
token values. Visual/contrast verification of the layer accents is deferred to the
MR-8 Playwright/visual pass (mirrors MR-1 DWD-3).
**What the double cannot model:** CSS cascade, computed `--layer-*` colors, paint,
and real DAG layout geometry.

## DWD-M2-4 — Orphan detection lives in the builder; edges are LIVE dependencies
**Decision:** `buildGraph(datasets, views, reports, archived)` is the single source
of orphan truth (path-forward §2.1/§3.5 — orphan is derived, never persisted). The
contract the RED suite pins:
- **Layers:** dataset → `staging`, view → `intermediate`, report → `mart`. The
  `source` layer is **reserved for MR-6** upload sources — MR-2 produces no
  source-layer nodes (datasets are the graph roots).
- **Edges are LIVE upstream→downstream dependencies:** an edge is emitted for a
  `source_ref` only when the referenced node is **present AND not archived**. Absent
  or archived refs produce no edge (a broken/severed link).
- **Orphan = a non-dataset node with zero live incoming edges** (every `source_ref`
  absent-or-archived, or none at all). Datasets are roots and are never orphans.
- **Archived set is EMPTY for MR-2** at the route (cold storage is MR-7), but the
  builder fully supports a non-empty set and the unit suite exercises archived-input
  orphaning so MR-7 can wire live archive state with no builder change.

## DWD-M2-5 — Three presentational views over ONE graph; orphan treatment per view
**Decision:** `FlowView` (left→right DAG; layer columns ordered staging →
intermediate → mart; orphan nodes `aria-disabled`), `LanesView` (one swimlane per
present layer; orphan nodes carry an "Orphaned" badge), `AuditView` (one stream row
per node with a per-model audit section; orphan flagged in-stream). The in-canvas
style switch (`PipelineCanvas`) holds the active style locally (default `flow`) and
renders the matching view over the same graph — no refetch on switch.
**AuditView audit scope for MR-2:** the per-model audit section surfaces the derived
dependency summary; the rich **Assistant-changes provenance panel is MR-5** (it may
need a backend read endpoint — path-forward §2.5 open-question 5). Documented so the
AuditView is honest about what it shows now.

## DWD-M2-6 — Mandate 7 scaffolding (TypeScript), pure-core placement
**Decision:** RED-ready scaffolds, each marked `__SCAFFOLD__`, bodies
`throw new Error("Not yet implemented — RED scaffold (lineage MR-2)")`:
- `frontend/src/core/lineage/buildGraph.ts` — pure core (framework-free), so the
  builder is testable in isolation (hexagonal — path-forward §4.5).
- `frontend/src/ui/components/Pipeline/{FlowView,LanesView,AuditView,PipelineCanvas}.tsx`
  + `index.tsx` (`PipelineLanding`, data-connected).
- `frontend/app/routes/pipeline.tsx` (route shim) + `routes.ts` registration.
**Verified RED (not BROKEN):** all 30 vitest cases fail with the scaffold marker,
zero import/resolve errors (`npx vitest run src/core/lineage src/ui/components/Pipeline`).
DELIVER replaces the bodies (GREEN) and removes the markers
(`grep -r __SCAFFOLD__ frontend/src/core/lineage frontend/src/ui/components/Pipeline
frontend/app/routes/pipeline.tsx` → empty at done).

## DWD-M2-7 — Driving-port / data-port note (port-to-port)
**Driving port:** the rendered project-landing route `projects/:projectId/pipeline`,
exercised in `PipelineLanding.test.tsx` through `createRoutesStub` at
`/projects/p1/pipeline` (proves the param wiring + landing render, not just that a
component renders — RCA P1 driving-adapter mandate, adapted to the FE route surface).
**Data port (driven):** the dataCatalog TanStack Query hooks (`useDatasets`,
`useViewsQuery`, `useReportsQuery`), doubled at the boundary (mirrors
`ViewDetailView.test`). The lineage graph is derived from this REST data — **not**
from the ui-state wire. No new driven adapter with real network I/O is introduced
by MR-2 (the REST client already has its own contract tests under
`src/core/dataCatalog/__tests__/`), so no `@real-io @adapter-integration` HTTP
scenario is added here.
