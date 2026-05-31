# DISTILL Wave Decisions — pipeline-layers-ui-redesign / MR-5

Slice: **MR-5 — Single-page model-detail recomposition (dependency strip +
Assistant-changes audit + data preview + columns/measures + compiled SQL) across
dataset / view / report detail views.**
Scope/decision source: `../path-forward.md` §2.5 (model detail — pure-frontend (a)
recomposition + the (c) decision points), §5 (MR-5), open questions 1/2/5/6, §9
(single Neobrutalist + Solarized `.dark`; no aesthetic switcher).
DESIGN-equivalent SSOT — no `docs/product/` journeys cover this redesign and no
DISCUSS user-stories exist for this feature (mirrors MR-1..MR-4). MR-5 artifacts are
namespaced `-mr5` so the MR-1/2/3/4 DISTILL/DELIVER records are preserved unchanged.

Prior-wave reading (READING ENFORCEMENT):
- `+ docs/feature/pipeline-layers-ui-redesign/path-forward.md` (§2.5, §5, open q 1/2/5/6, §9)
- `+ docs/feature/pipeline-layers-ui-redesign/design-sources.md` (prototype pulled on demand only — not needed; happy-dom asserts structure not pixels)
- `+ docs/feature/pipeline-layers-ui-redesign/distill/roadmap-mr4.json`
- `+ docs/feature/pipeline-layers-ui-redesign/distill/wave-decisions-mr4.md`
- `+ docs/feature/pipeline-layers-ui-redesign/deliver/wave-decisions-mr4.md`
- `+ docs/feature/pipeline-layers-ui-redesign/distill/upstream-issues.md`
- `+ docs/product/architecture/brief.md` (no "For Acceptance Designer" driving-port section — UI-3; FE driving ports derived from the rendered route surface)
- `+ docs/product/journeys/{login-and-org-setup,project-and-chat-session-management}.yaml` (neither covers the model-detail redesign — graceful degradation, ACs derived from DESIGN)
- `- docs/product/kpi-contracts.yaml` (not found — soft gate)
- `- docs/feature/pipeline-layers-ui-redesign/discuss/*` (not found — no DISCUSS for this feature)
- `- docs/feature/pipeline-layers-ui-redesign/design/*` (not found — path-forward.md is the DESIGN SSOT)
- `- docs/feature/pipeline-layers-ui-redesign/devops/*` (not found — default env matrix N/A; pure-FE vitest slice)
- `- docs/feature/pipeline-layers-ui-redesign/spike/*` (not found — no spike)

Wave-decision reconciliation: **0 contradictions.** MR-1 delivered the token layer
(`frontend/app/theme/`) the model-detail chrome consumes via `ModelDetail.module.css`;
MR-2 delivered the lineage builder (`frontend/src/core/lineage/buildGraph.ts`) the
dependency strip reuses via the new `deriveModelDependencies` + `useModelDependencies`;
MR-4 reshelled chat into the assistant overlay these detail pages now sit beneath. The
deps-strip link targets (`/table/:id`, `/view/:id`, `/report/:id`) are the MR-2 node
detail routes, unchanged. All are carry-forwards anticipated by the prior MRs.

---

## DWD-M5-1 — Walking Skeleton Strategy: C (real local I/O), vitest-gated
**Decision:** Strategy C — frontend-only, no backend/external/costly deps (mirrors
MR-1..MR-4). The ports MR-5 touches are the **existing dataCatalog list/detail hooks**
(`useDatasets`/`useViewsQuery`/`useReportsQuery`/`useViewQuery`/`useReportQuery`/
`useDatasetQuery` — the model + lineage data), the **existing chat context**
(`useChatContext` — the assistant-changes feed), and the **rendered model-detail route
surface** (deps-strip navigation). The acceptance gate is the **vitest** suite
(`happy-dom`), NOT a pytest acceptance suite — none exists for this feature and none was
created. The walking-skeleton thin slice is the deps-strip navigation case
(`DependencyStrip.test > "@walking_skeleton navigates to a linked model's detail route
on click"`). Pre-baked per the headless run brief; not gated on interactive WS confirmation.

## DWD-M5-2 — happy-dom limitation: assert STRUCTURE/VALUES, not computed colors
**Decision:** happy-dom does **not** apply stylesheets, so the MR-5 tests assert
testids, rendered values (model names, column names, SQL text), the SQL-panel toggle,
and navigation (via `createRoutesStub`) — **never** computed colors or the MR-1 token
values. The Neobrutalist/Solarized pixel + contrast detail is deferred to the MR-8
Playwright/visual pass (mirrors MR-1..MR-4).

## DWD-M5-3 — Reuse-and-recompose; the ui-state wire is NOT touched; NO backend endpoint
**Decision (load-bearing, saved-feedback constraint):** MR-5 RECOMPOSES the three
existing detail views into one consistent single-page layout — it does not rewrite them
and does not add a chat/ui-state/agent surface. Model data comes from the EXISTING
dataCatalog TanStack Query hooks; the dependency strip reuses the EXISTING MR-2
`buildGraph`. No `@dashboard-chat/ui-state-wire` / `lib/ui-state-client` import is added;
the chat transport + agent contract are untouched. NO backend read endpoint is added —
the two backend touches in this redesign are explicitly reserved for MR-6 (display_name)
and MR-7 (archive/retention). The existing chat affordances (ChatInput, ActivityLog,
setContext, tool handlers, the report's registerTableSchema layerContext, the dataset's
table wiring) are preserved verbatim.

## DWD-M5-4 — Dependency strip: derived from existing fields via the MR-2 lineage builder
**Decision:** The deps strip shows BOTH directions. **Upstream** producers and
**downstream** consumers are derived by building the MR-2 lineage graph over the model's
project (the existing `useDatasets`/`useViewsQuery`/`useReportsQuery` lists) and reading
the edges incident to the model (`deriveModelDependencies`). This resolves node **names**
+ **kinds** (the raw `source_refs` carry only id+type) and uniformly gives a dataset its
downstream consumers (datasets are lineage roots with no `source_refs`, so an
upstream-only strip would be empty for them). Each node links by kind:
dataset→`/table/:id`, view→`/view/:id`, report→`/report/:id` (the MR-2 detail routes).
A pure `deriveModelDependencies(modelId, graph)` core function + a thin
`useModelDependencies(projectId, modelId)` hook keep the derivation testable in isolation
and the strip a pure presentational component.

## DWD-M5-5 — "Assistant changes" audit provenance (open q5) → live-session shell, persisted feed deferred (c)
**Decision (resolved by code inspection, NOT blocked):** No backend endpoint serves a
per-model audit/change feed today, and the `Session` / `Message` / `ToolCall` shapes
carry **no model id** (sessions are project-scoped; the model context set via
`setContext` is runtime-only and is NOT persisted on messages). The only per-model
provenance derivable client-side is the **live chat session bound to the current model**
— the assistant tool-calls in `useChatContext().messages` while the user is on that
model's detail page. So the audit panel is fed by a pure `deriveAssistantChanges(messages)`
helper (assistant tool-calls → {tool, summary} entries) with an explicit empty-state when
none. The richer **persisted, cross-session per-model audit feed** (path-forward open q5)
requires a NEW backend read endpoint and is logged as a deferred **(c)** in
`upstream-issues.md` UI-5 — NOT built in MR-5 (backend touches reserved for MR-6/MR-7).

## DWD-M5-6 — View/report data preview (open q6) → dataset ships, view/report deferred (c)
**Decision (resolved by code inspection, NOT blocked):** Only `Dataset` carries
`preview_rows`, and only `getDataset` accepts `{ includePreview }`. `getView`/`getReport`
return `View`/`Report` shapes with **no** sample-rows field. So: the **dataset** layer's
data-preview section ships now (the existing interactive `TablePanel`, the dataset's real
preview grid). The **view/report** layers render a documented "preview not yet available"
empty-state (`data-preview-unavailable`). Computing view/report sample rows requires the
query engine to materialize a sample — a deferred **(c)** logged in `upstream-issues.md`
UI-6. No backend sample endpoint is invented in MR-5.

## DWD-M5-7 — Superseded detail markup re-specified (RED authored FIRST, NOT an Iron-Rule violation)
**Decision:** The single-page layout legitimately replaces the old per-view fragments:
the standalone `source-dependency-list` (upstream-only id list) becomes the bidirectional
`DependencyStrip`, and the old `sql-preview-*` panels become the consistent
`CompiledSqlPanel` (`compiled-sql-*`); for views, the compiled SQL shown switches from
`display_sql` ("for reference only") to `sql_definition` (the ref()-wired compiled SQL the
design calls for). The re-spec edits to `ViewDetailView.test.tsx` / `ReportDetailView.test.tsx`
were authored FIRST and verified RED against the un-recomposed components — deleting/
re-specifying superseded markup with the new RED authored first is explicitly permitted
(saved-feedback) and is NOT weakening a passing assertion to force green. The
`ReportDetailView.integration.test.tsx` (tool-call flow) keeps its assertions; if the
recomposition's new `useModelDependencies` call disturbs its mount, a `useModelDependencies`
double is added there in DELIVER (test-infra only — it asserts no detail markup).

## DWD-M5-8 — Mandate 7 scaffolding (TypeScript), verified RED (not BROKEN)
**Decision:** RED-ready scaffolds, each marked `export const __SCAFFOLD__ = true`, with
function/component bodies `throw new Error("Not yet implemented — RED scaffold …")`
(NOT `NotImplementedError`, so they read RED not BROKEN):
- `frontend/src/core/lineage/dependencies.ts` (`deriveModelDependencies`)
- `frontend/src/core/chat/assistantChanges.ts` (`deriveAssistantChanges`)
- `frontend/src/ui/hooks/useModelDependencies.ts`
- `frontend/src/ui/components/ModelDetail/{DependencyStrip,AssistantChangesPanel,DataPreviewGrid,CompiledSqlPanel,DatasetColumnsTable,ModelDetailLayout}.tsx`
- `frontend/src/ui/components/ModelDetail/ModelDetail.module.css` (real CSS consuming MR-1 tokens — CSS cannot scaffold-throw)
- `frontend/src/ui/components/ModelDetail/index.ts` (barrel)
**Verified RED (not BROKEN):** `npx vitest run` over the 11 MR-5 files → **61 collected,
47 failed / 14 passed, 0 import/resolve errors**. The 47 RED = the scaffold-throw + new
markup assertions; the 14 passes are still-true legacy assertions on the un-recomposed
detail views (error state, setContext, tool handler, ChatInput, description, the retained
columns tables). DELIVER replaces the bodies (GREEN) and removes the markers (grep → empty).

## DWD-M5-9 — Test-boundary decisions (port-to-port, isolation)
- **Driving port:** the rendered model-detail route surface, exercised via
  `createRoutesStub` (deps-strip navigation: a real link click → the destination detail
  route renders — proving the wiring, not merely that a link exists).
- **Lineage/model data port (driven):** the existing list/detail hooks doubled at the
  boundary (`useModelDependencies` doubled in the detail-view tests; the underlying list
  hooks doubled in the `useModelDependencies` unit test). No new driven adapter with real
  network I/O is introduced — the dataCatalog REST client is already contract-tested under
  `src/core/dataCatalog/__tests__/`, so no new `@real-io @adapter-integration` scenario is
  added (mirrors MR-2/3/4).
- **Chat-feed port (driven):** `useChatContext` doubled at the boundary; the audit panel
  is fed by the pure `deriveAssistantChanges` over the doubled messages.
- **Pure core tested directly:** `deriveModelDependencies` + `deriveAssistantChanges` are
  framework-free pure functions with their own unit suites (no router/QueryClient needed).
- **TablePanel stubbed in the dataset detail test:** its TanStack-table behavior is covered
  by its own tests; the dataset detail test stubs it and asserts only that the data-preview
  section mounts it (keeps the heavy table wiring as thin, verifiable glue).

## DWD-M5-10 — Single Neobrutalist + Solarized `.dark`; no aesthetic switcher
**Decision:** `ModelDetail.module.css` consumes the MR-1 `--color-*` / `--border-width` /
`--radius` / `--shadow` / `--layer-*` tokens; no `.theme-*` aesthetic selector is added
(path-forward §9 — Option A locked). Dark mode is respected via the orthogonal `.dark`
root class (MR-1). No appearance control is introduced here.

---

## Adapter coverage table (Mandate 6)
| Adapter | @real-io scenario | Covered by |
|---------|-------------------|------------|
| dataCatalog list/detail hooks (`useDatasets`/`useViewsQuery`/`useReportsQuery`/`useViewQuery`/`useReportQuery`/`useDatasetQuery`) | N/A — pre-existing client; contract-tested under `src/core/dataCatalog/__tests__/` | doubled at the port in the hook + detail-view tests (mirrors MR-2/3) |
| chat context (`useChatContext` — assistant-changes feed) | N/A — pre-existing provider; not re-wired by MR-5 | doubled at the port in the detail-view tests (mirrors MR-4) |

No new driven adapter with real network I/O is introduced by MR-5 → no `NO — MISSING` rows.

## Self-review checklist
- [x] WS strategy declared (DWD-M5-1).
- [x] Gate is vitest (`happy-dom`); structure/values/navigation asserted, not colors (DWD-M5-2).
- [x] No new driven adapter → no missing @real-io scenario (table above).
- [x] InMemory/double limits documented: happy-dom can't model CSS cascade/tokens; the
      doubled hooks can't model SSE latency/network errors; live-session audit ≠ persisted
      per-model feed (deferred c, UI-5); view/report preview not served (deferred c, UI-6).
- [x] Mandate 7: every imported production module has a `__SCAFFOLD__` stub; bodies throw
      `Error` (RED, not `NotImplementedError`/ImportError); **61 collected, 47 RED, 0 BROKEN**.
- [x] No `__SCAFFOLD__` expected to remain after DELIVER (grep gate in roadmap).
- [x] Driving-adapter: the FE has no CLI/HTTP/hook entry point; the user's invocation path
      is the rendered model-detail route surface + deps-strip navigation, exercised via
      `createRoutesStub` at real paths (FE analog, mirrors MR-2/3/4).
- [x] Error/edge coverage ≥ 40%: of the 61 cases, the non-happy-path/branch coverage —
      deps-strip empty + loading states, unknown-model-id derivation, audit empty-state,
      preview unavailable + empty-rows + maxRows cap, compiled-sql empty-state, dataset
      columns empty-state, detail-view error states, bad-JSON arg fallback — comfortably
      exceeds 40%.
