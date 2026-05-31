# Walking Skeleton — pipeline-layers-ui-redesign / MR-2

> Notes only. The executable SSOT is the vitest suite:
> `frontend/src/core/lineage/buildGraph.test.ts` (14) +
> `frontend/src/ui/components/Pipeline/PipelineViews.test.tsx` (13) +
> `frontend/src/ui/components/Pipeline/PipelineLanding.test.tsx` (3). 30 cases.

## The thin slice
Land on a selected project's **Pipeline** and see its lineage: nodes derived from
the project's datasets / views / reports, edges from `source_refs`, rendered as a
left→right Flow DAG, switchable in-canvas to Lanes and Audit, with orphan nodes
treated correctly. No backend change; data comes from the existing dataCatalog
hooks; the ui-state wire is untouched.

## Walking-skeleton scenario (DWD-M2-1) — `@walking_skeleton @real-io`
`PipelineLanding.test.tsx > "renders the pipeline canvas with a node per catalog
item for the active project"` — real route-param (`/projects/p1/pipeline` via
`createRoutesStub`) → data hooks (doubled at the port boundary) → `buildGraph` →
rendered `PipelineCanvas` (default Flow). This is the end-to-end project-landing
path: param in, lineage canvas out.

## Scenario inventory (30 cases)

### buildGraph — pure core (14) · `frontend/src/core/lineage/buildGraph.test.ts`
| Group | Scenario | Kind |
|---|---|---|
| layer/kind | datasets→staging, views→intermediate, reports→mart (node per item) | happy |
| layer/kind | no source-layer nodes in MR-2 | edge |
| edges | edge per view source_ref | happy |
| edges | report edges over dataset + view upstreams | happy |
| edges | one upstream → multiple downstreams = distinct edges | happy |
| edges | duplicate ref → single edge (dedup) | edge |
| edges | absent upstream → no dangling edge | edge |
| orphan | dataset root is never orphan (even with no refs) | happy |
| orphan | view live when ≥1 input present+unarchived | happy |
| orphan | view orphan when every ref absent | edge |
| orphan | non-dataset with no refs → orphan | edge |
| orphan | view orphan when its only input is archived; archived node flagged; no edge | edge |
| orphan | report orphan when all inputs absent-or-archived | edge |
| empty | empty inputs → empty graph, no throw | edge |

### Presentational views + style switch (13) · `PipelineViews.test.tsx`
| View | Scenario | Kind |
|---|---|---|
| FlowView | node element per node | happy |
| FlowView | layer columns ordered staging→intermediate→mart | happy |
| FlowView | edge element per edge | happy |
| FlowView | orphan node disabled, live node enabled | edge |
| LanesView | one lane per present layer | happy |
| LanesView | node inside its layer's lane | happy |
| LanesView | "Orphaned" badge on orphan nodes only | edge |
| AuditView | stream row + audit-detail per node | happy |
| AuditView | orphan flagged in stream | edge |
| Canvas | defaults to Flow | happy |
| Canvas | switch control per style | happy |
| Canvas | click → Lanes → Audit | happy |
| Canvas | initialStyle override | edge |

### Landing surface (3) · `PipelineLanding.test.tsx`
| Scenario | Kind |
|---|---|
| renders canvas + node per item for active project (WS) | happy |
| loading state while catalog data in flight | edge |
| empty state when project has no models | edge |

Error/edge ≈ 15/30 (~50%), exceeding the 40% target.

## Adapter coverage
| Port | Role | Doubled? | Covered by |
|---|---|---|---|
| dataCatalog REST hooks (`useDatasets`/`useViewsQuery`/`useReportsQuery`) | driven (data) | yes, at the boundary | PipelineLanding suite |
| project-landing route `projects/:projectId/pipeline` | driving | real (createRoutesStub) | PipelineLanding WS scenario |

The REST client's own real-I/O contract lives in `src/core/dataCatalog/__tests__/`
(unchanged by MR-2). No new driven adapter with network I/O → no new
`@real-io @adapter-integration` HTTP scenario (DWD-M2-7).

## RED→GREEN handoff (DELIVER)
Scaffolds (all `__SCAFFOLD__`, bodies throw the RED marker; verified RED 30/30,
zero BROKEN):
- `frontend/src/core/lineage/buildGraph.ts`
- `frontend/src/ui/components/Pipeline/{FlowView,LanesView,AuditView,PipelineCanvas,index}.tsx`
- `frontend/app/routes/pipeline.tsx` (+ `frontend/app/routes.ts` registration)

DELIVER implements `buildGraph` (layers + live edges + orphan), the three views +
canvas (consuming MR-1 `--layer-*` tokens), and the data-connected `PipelineLanding`
(reads `projectId` from params, pulls the three hooks, builds with an empty archived
set, renders the canvas, handles loading/empty). Done when all 30 cases are GREEN,
the full frontend suite stays green, and
`grep -r __SCAFFOLD__ frontend/src/core/lineage frontend/src/ui/components/Pipeline frontend/app/routes/pipeline.tsx`
is empty.

## Run
```bash
cd frontend && npx vitest run src/core/lineage src/ui/components/Pipeline   # the MR-2 suite (RED now)
cd frontend && npx vitest run                                               # full FE suite (must stay green)
```
