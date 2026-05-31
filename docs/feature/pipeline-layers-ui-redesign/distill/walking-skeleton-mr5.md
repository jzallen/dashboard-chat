# Walking Skeleton — pipeline-layers-ui-redesign / MR-5

> Notes only. The scenario SSOT is the vitest suite (the `ModelDetail/*.test.tsx`
> primitives + the re-spec'd `ViewDetailView.test.tsx` / `ReportDetailView.test.tsx`
> + the new `TableView.detail.test.tsx`, plus the pure `core/lineage/dependencies.test.ts`
> and `core/chat/assistantChanges.test.ts`). happy-dom is the medium (DWD-M5-2):
> assert structure / testids / rendered values / navigation, never computed colors.

## Strategy
**C — real local I/O, frontend-only** (DWD-M5-1). No backend / external / costly deps.
The gate is `cd frontend && npx vitest run`. No pytest acceptance suite (none exists
for this feature; mirrors MR-1/2/3/4). NO backend endpoint is added (the two backend
touches in this redesign are reserved for MR-6/MR-7).

## The thin slice (`@walking_skeleton`)
`DependencyStrip.test > "@walking_skeleton navigates to a linked model's detail route
on click"`: a real dependency-strip link → a real `react-router` navigation through
`createRoutesStub` → the linked model's detail route renders. This proves the
load-bearing MR-5 premise end-to-end: the model-detail dependency strip is a real
lineage-derived, route-wired navigation surface (not a static list) — the user can
walk the pipeline by clicking from one model's detail page to its upstream/downstream
neighbours. Navigation is asserted by destination render, not a spy (DWD-M5-9).

## Driving port (FE analog)
The rendered model-detail route surface via `createRoutesStub` / `MemoryRouter`. There
is no CLI/HTTP/hook entry point in the frontend; the user's actual invocation path is
landing on `/table/:id`, `/view/:id`, `/report/:id` and clicking a dependency link to a
sibling model's detail route. The deps-strip links are exercised at real paths with real
destination routes (DWD-M5-9).

## Scenario inventory (61 MR-5 cases, 11 files)
**Pure core (9)** — `dependencies.test.ts` (5: upstream/downstream for middle/root/leaf
nodes, full node objects, unknown id) · `assistantChanges.test.ts` (4: tool-call →
entry mapping + order, ignore user/no-tool-call messages, raw-string fallback on bad
JSON, empty conversation).
**Hook (2)** — `useModelDependencies.test.tsx`: derives upstream/downstream from the
project graph (list hooks doubled at the boundary); reports `isLoading` while any
underlying list query loads.
**Presentational primitives (17)** — `DependencyStrip.test.tsx` (6, incl.
`@walking_skeleton`) · `AssistantChangesPanel.test.tsx` (2) · `DataPreviewGrid.test.tsx`
(4) · `CompiledSqlPanel.test.tsx` (3) · `DatasetColumnsTable.test.tsx` (2).
**Detail-page integration / re-spec (33)** — `ViewDetailView.test.tsx` (13) ·
`ReportDetailView.test.tsx` (13) · `TableView.detail.test.tsx` (8) — each asserts the
real recomposed page renders the deps strip (with navigating links), the audit panel,
the data-preview section (grid for dataset / documented empty-state for view+report),
the columns/measures table, and the compiled-SQL panel (toggle reveals the ref()-wired
text), while preserving the existing chat affordances (setContext, tool handler,
ChatInput, report layerContext, dataset table wiring).

## What the doubles CANNOT model
- happy-dom does not apply the token stylesheet → no Neobrutalist/Solarized contrast
  or glass/shadow assertions (MR-8 Playwright pass).
- The doubled `useChatContext` / `useModelDependencies` / list hooks do not model real
  SSE streaming or network latency/errors (covered by the existing chat/stream + REST
  contract tests; out of scope for a presentation recomposition).
- The **Assistant-changes panel** is fed by the LIVE session's assistant tool-calls
  (`deriveAssistantChanges(messages)`) — the only per-model provenance available
  client-side today. A PERSISTED cross-session per-model audit feed needs a new backend
  read endpoint and is a deferred (c) — see `upstream-issues.md` UI-5.
- **View/report data preview** is NOT served by the API today (only `Dataset.preview_rows`
  exists). Those layers render a documented "preview not yet available" empty-state — a
  deferred (c) requiring query-engine sampling — see `upstream-issues.md` UI-6.
