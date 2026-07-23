# Root Cause Analysis — Archiving a source node 404s (DC-195)

Method: Toyota 5 Whys, multi-causal, evidence at every level (file:line).
Scope: display-only. Warehouse/SQL-model repoint semantics are OUT OF SCOPE (DC-139).
Note: mandated skill files under `~/.claude/skills/nw-*` were permission-denied at load time
(`[SKILL MISSING] nw-investigation-techniques`, `[SKILL MISSING] nw-five-whys-methodology`);
the Toyota 5-Whys methodology was applied directly.

## Problem statement (scoped)

Clicking "Move to cold storage" in the **source** Upload modal submits the **source node's id**
to the **dataset** archive route. The source id is not a dataset id, so the backend returns 404,
the archive fails, and the source never reaches Cold Storage. Separately, the product intent that
downstream nodes losing their only ingress become *disabled-but-visible* is not yet implementable
because the graph's disabled/orphan derivation excludes the layer those downstream nodes live in.

## Evidence collected

| # | Fact | Evidence |
|---|------|----------|
| E1 | The source modal's archive affordance targets the **dataset** archive route with the source id. | `ui/app/components/Upload/hooks.ts:104-115` — `archiveSource(src)` → `POST /ui-server/datasets/${src.id}/archive`, `src` is a `LineageNode`. |
| E2 | The affordance is wired from the **source** Upload modal, passing the source node. | `ui/app/components/Upload/Upload.tsx:291-302` — `onArchive({ ...source, label })`; `source` is the source `LineageNode`. Reaches `archiveSource` via `Overlays.tsx:94`. |
| E3 | The ui-server broker forwards **verbatim** to the backend dataset route; upstream status passed through so the caller rolls back. | `ui/app/routes/ui-server/dataset-archive.tsx:16-40` — `apiFetch(request, /datasets/${datasetId}/archive)`, `status: upstream.status`. |
| E4 | The backend exposes archive/restore ONLY under `/api/datasets/{id}`. There is **no** `/api/sources/{id}/archive`. | `backend/app/routers/datasets.py:77-94`; `backend/app/routers/sources.py` — `grep archive` → none (only create/list/get/uploads/process). |
| E5 | A **source** node is a distinct entity from a **dataset**/staging node — different layer, no backend model entity, no `ref`. Source ids ≠ dataset ids. | `ui/app/catalog/lineage.ts:19` (`SOURCE_LAYER`), `:37-58` (`modelKindForLayer` → `undefined` for source), `:131` (`ref?` "absent for source nodes"). |
| E6 | The source→staging relationship is a graph **edge** `[source_id, dataset.id]`; the dataset carries `source_id`. Archiving the source is not the same operation as archiving its child dataset. | `ui/app/catalog/dataSources/lineageMappers.ts:245,255` — `edges.push([d.source_id, d.id])`. |
| E7 | Cold Storage / archive is modelled backend-side on the **dataset** (`archived_at`, `retention_until`); the mapper derives `coldRecords` from archived **datasets**. | `datasets.py:77-84`; `lineageMappers.ts:240-256`. |
| E8 | The graph's disabled/greyed rendering is driven by `orphans()`, and `orphans()` **excludes** `source` AND `staging`. A staging node that loses its only source ingress is therefore never flagged. | `ui/app/catalog/lineageGraph.ts:225-237` — `if (n.layer !== "source" && n.layer !== "staging" && !parents…)`. |
| E9 | The disabled/greyed presentation already exists and keys off `data-orphan` from `catalog.orphans()`. | `ui/app/components/LineageCanvas/dagView.tsx:126,167`, `swimLanes.tsx:118-120`, `lineageCanvas.module.css:100-116` ("orphaned (no inputs) — shown disabled in Flow"). |

## Toyota 5 Whys — multi-causal

### Branch A — the 404 (wrong endpoint / domain mismatch)

- **WHY 1 (symptom):** `POST /api/datasets/{sourceId}/archive` → 404. — E3, E4
- **WHY 2 (context):** The id in the path is a **source** id, but the route resolves **datasets**; no dataset exists with a source's id. — E1, E5, E6
- **WHY 3 (system):** The source modal's archive action is hard-coded to the dataset archive route (`/ui-server/datasets/${src.id}/archive`) regardless of the node's layer. — E1
- **WHY 4 (design):** There is **no source-archive path at all** — not in the ui-server broker, not in the backend. Archive/Cold-Storage was modelled solely on the dataset entity; the source modal reused the only archive route that existed. — E4, E7
- **WHY 5 (root cause A):** **Domain gap — "archive a source" is an unmodelled operation.** Cold Storage was designed around datasets (`archived_at` on the dataset), while sources are a separate upstream entity with no archive concept. The UI grew a source-facing "Move to cold storage" affordance with no corresponding source-archive operation, so it borrowed the dataset route and the source id fell through as a bad dataset id. — E4, E5, E7

### Branch B — downstream nodes do not become disabled-but-visible

- **WHY 1 (symptom):** Even once a source is archived, downstream nodes that lose their only ingress are not greyed-out/visible-but-disabled per intent.
- **WHY 2 (context):** Disabled/greyed rendering is derived exclusively from `catalog.orphans()`. — E9
- **WHY 3 (system):** `orphans()` returns only `intermediate`/`mart` nodes with no parents; it **excludes `staging`** (the layer that a source feeds). A staging dataset stripped of its source edge is treated as a legitimate root, not an orphan. — E8
- **WHY 4 (design):** "Orphan" was defined as *structurally rootless in the middle of the pipeline*, deliberately treating source and staging as always-valid entry points (docstring at `lineageGraph.ts:219-224`). The design predates the "source archived → downstream loses ingress" requirement, so "lost its upstream source" is not an expressible state. — E8
- **WHY 5 (root cause B):** **Ingress-loss is not a representable node state.** The graph models "disabled/greyed" only as *structural orphanhood excluding staging*; there is no notion of "a staging node whose only source has been archived." So the display requirement (DC-195) has no hook, independent of the 404. — E8

### Completeness check
Branch A explains the 404 and rollback. Branch B explains why, after A is fixed, the downstream-disabled
half of the intent still would not render. The two are independent root causes and must both be closed to
satisfy DC-195. No third branch found: the ui-server broker (E3) and optimistic rollback are correct
mechanics — they faithfully surface the upstream 404; they are not a cause.

## Backwards-chain validation

- **A:** If "archive a source" is unmodelled (RC-A), then the affordance must reuse the dataset route with a
  source id → backend resolves datasets by that id → none exists → 404 → optimistic rollback → node stays.
  Matches the observed network trace exactly. ✔ (E1→E3→E4)
- **B:** If ingress-loss is not representable (RC-B), then archiving a source (once A is fixed) removes the
  `[source_id, dataset.id]` edge, the staging child becomes parent-less, but `orphans()` skips staging → no
  `data-orphan` → renders as a normal active node, contradicting intent. ✔ (E6→E8→E9)
- No contradiction between branches: A is about the *write path* (which endpoint), B about the *derive/render
  path* (disabled state). They touch disjoint modules.

## Root causes

- **RC-A (immediate + design):** No source-archive operation exists; the source "Move to cold storage"
  affordance is bound to the dataset archive route and submits a source id, which 404s.
- **RC-B (design):** The graph cannot express "downstream node lost its only source ingress," because
  disabled/greyed rendering is derived from `orphans()`, which excludes the staging layer.

## Solutions (display-scoped; no SQL-model/warehouse work)

### Fix for RC-A — archive the source by archiving the datasets it feeds (display-scoped)

The intent "archiving a source moves it to Cold Storage" is satisfiable within the existing dataset-archive
machinery, because Cold Storage is modelled on the dataset (E7) and the source→staging edges are known on the
client (E6). Two viable shapes:

- **Preferred (client resolves target datasets):** In `archiveSource` (`hooks.ts:104`), when the node is a
  source (`layer === "source"`), resolve its child staging dataset id(s) via the catalog graph
  (`childrenOf(source.id)` filtered to `staging`) and submit the existing
  `/ui-server/datasets/{datasetId}/archive` for each — reusing the working route (E3/E4) with a **valid
  dataset id**. The source node itself is a display-only construct with no backend entity (E5), so "the source
  is in Cold Storage" is represented by its dataset children being archived (they already become `coldRecords`,
  E7). No new backend route; strictly within display scope.
  - Closes: RC-A. Regression test asserts: archiving a source submits `POST /ui-server/datasets/{childDatasetId}/archive` (a real dataset id, **not** the source id) and no request is ever sent to `/ui-server/datasets/{sourceId}/archive`; on 2xx the source (and its archived child) leave the active canvas and appear in Cold Storage.
- **Alternative (broker resolves):** add a `/ui-server/sources/{id}/archive` broker that resolves the source's
  datasets and fans out to the dataset archive. Heavier; only needed if resolution must be server-side. Same
  assertion target (never the source id against the dataset route).

Whichever shape: the load-bearing behavioural guarantee is **the source id is never used as a dataset id**.

> **Correction (adopted).** Both shapes above cascade a **backend** archive from a source action —
> derive the child datasets, then archive them. That is the very cascade this fix must avoid: it deletes
> a downstream dataset as a side effect of retiring its source. A source node backs **no backend entity**
> (E5), so "archive a source" has no backend meaning at all. The adopted fix is **client-only**:
> `archiveSource` moves the source into the working graph's cold storage via the existing pure
> `LineageGraph.archive` reducer and **posts nothing**. Its staging children simply lose their live
> ingress and render disabled-but-visible (RC-B) — no dataset is archived or deleted. Restore is
> symmetric and entity-routed: a client-archived **source** restores locally through the graph, while a
> server-archived **dataset** still restores via the backend (`archived_at` cleared). The load-bearing
> guarantee becomes stronger: **archiving a source issues no backend request whatsoever.**

### Fix for RC-B — mark downstream nodes that lost their only source ingress as disabled-but-visible

Introduce a derivation for "a staging node whose only source ingress is gone (source archived)" and feed the
**existing** `data-orphan` disabled presentation (E9) — greyed-out but still rendered, per intent (remappable
later). Concretely, extend the disabled-state derivation so a `staging` node with **no** active source parent
is included (distinct from the current `orphans()` which excludes staging). Keep it display-only: no edge is
deleted from warehouse state, the node stays visible for remap.

- Closes: RC-B. Regression test asserts: given `[source, staging]` with the source archived (edge gone /
  source no longer active), the staging node is reported as disabled and **still present** in the rendered
  node set (`data-orphan` / disabled class applied, node not removed); an unaffected staging node with a live
  source is **not** disabled.

## DISTILL regression test — required assertions

**Archive path (RC-A) — client-only, no backend write (adopted):**
1. Invoking the source modal's "Move to cold storage" issues **no** backend request at all — in particular nothing to `/ui-server/datasets/*/archive` (the source id must never be threaded to the dataset route, and no child dataset is archived as a side effect).
2. The source is removed from the active graph and appears in Cold Storage (`listColdStorage()` includes it, layer `source`).
3. (Guard) A source feeding multiple staging children still issues no backend request; every child is disabled-but-visible.
4. Restore is entity-routed: a client-archived source restores locally (no backend); a server-archived dataset restores via `POST /ui-server/datasets/{id}/restore`.

**Downstream-disabled-but-visible path (RC-B):**
5. Given a `source → staging` graph, after the source is archived, the staging node is flagged disabled (surfaced through the same `data-orphan`/disabled presentation) AND remains in the rendered node set (visible, not deleted).
6. A staging node still fed by a live source is NOT flagged disabled.
7. (Guard) Downstream intermediate/mart nodes fed only through the now-disabled staging chain remain visible; existing `orphans()` behaviour for genuinely rootless intermediate/mart nodes is unchanged (no regression to `lineageGraph.ts:225-237`).

## Out of scope (do not implement here)
Warehouse repoint / SQL-model rewiring on ingress loss (DC-139). This RCA changes only which endpoint the
source affordance calls and how disabled state is *derived and rendered* — no backend warehouse changes.
