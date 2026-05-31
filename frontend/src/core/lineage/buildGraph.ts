// Lineage graph builder — pure core (MR-2).
//
// Suite authored by DISTILL (path-forward.md §2.1/§4.5); body implemented at DELIVER.
//
// `buildGraph` derives a layered lineage DAG from the dataCatalog REST data
// (datasets / views / reports) — NOT from ui-state. It is framework-free and
// testable in isolation. Orphan detection lives here (the single source of truth):
// a non-root node whose inputs are all absent-or-archived is an orphan.
import type { Report } from "@/dataCatalog";
import type { View } from "@/dataCatalog";

/** dbt-style pipeline layers. `source` (raw uploads) is reserved for MR-6 —
 *  MR-2 produces no source-layer nodes (datasets are the graph roots). */
export type LineageLayer = "source" | "staging" | "intermediate" | "mart";

/** The catalog origin a node was derived from. */
export type LineageKind = "dataset" | "view" | "report";

/** Minimal shape buildGraph needs from a dataset (DatasetSparse satisfies it). */
export interface LineageDatasetInput {
  id: string;
  name: string;
}

export interface LineageNode {
  id: string;
  name: string;
  layer: LineageLayer;
  kind: LineageKind;
  /** A non-root node whose inputs are all absent-or-archived. Roots are never orphans. */
  orphan: boolean;
  /** Present in the archived set passed to buildGraph (empty for MR-2). */
  archived: boolean;
}

export interface LineageEdge {
  /** Upstream (producer) node id. */
  from: string;
  /** Downstream (consumer) node id. */
  to: string;
}

export interface LineageGraph {
  nodes: LineageNode[];
  edges: LineageEdge[];
}

/**
 * Build the layered lineage graph.
 *
 * Nodes: datasets → `staging`, views → `intermediate`, reports → `mart`.
 * Edges: each `source_ref` on a view/report becomes an upstream→downstream edge
 *        (only when the referenced node is present in the graph).
 * Orphan: a view/report whose every `source_ref` is absent-or-archived (or which
 *         has no refs at all). Datasets are roots and never orphans.
 */
export function buildGraph(
  datasets: readonly LineageDatasetInput[],
  views: readonly View[],
  reports: readonly Report[],
  archived: ReadonlySet<string>,
): LineageGraph {
  const present = new Set<string>();
  datasets.forEach((dataset) => present.add(dataset.id));
  views.forEach((view) => present.add(view.id));
  reports.forEach((report) => present.add(report.id));

  const isLive = (id: string): boolean => present.has(id) && !archived.has(id);

  const edges: LineageEdge[] = [];
  const seenEdges = new Set<string>();
  const liveInputCount = new Map<string, number>();

  const linkUpstreams = (
    nodeId: string,
    sourceRefs: ReadonlyArray<{ id: string }>,
  ): void => {
    sourceRefs.forEach((ref) => {
      if (!isLive(ref.id)) return;
      liveInputCount.set(nodeId, (liveInputCount.get(nodeId) ?? 0) + 1);
      const key = JSON.stringify([ref.id, nodeId]);
      if (seenEdges.has(key)) return;
      seenEdges.add(key);
      edges.push({ from: ref.id, to: nodeId });
    });
  };

  views.forEach((view) => linkUpstreams(view.id, view.source_refs));
  reports.forEach((report) => linkUpstreams(report.id, report.source_refs));

  const nodes: LineageNode[] = [];

  datasets.forEach((dataset) => {
    nodes.push({
      id: dataset.id,
      name: dataset.name,
      layer: "staging",
      kind: "dataset",
      orphan: false,
      archived: archived.has(dataset.id),
    });
  });

  views.forEach((view) => {
    nodes.push({
      id: view.id,
      name: view.name,
      layer: "intermediate",
      kind: "view",
      orphan: (liveInputCount.get(view.id) ?? 0) === 0,
      archived: archived.has(view.id),
    });
  });

  reports.forEach((report) => {
    nodes.push({
      id: report.id,
      name: report.name,
      layer: "mart",
      kind: "report",
      orphan: (liveInputCount.get(report.id) ?? 0) === 0,
      archived: archived.has(report.id),
    });
  });

  return { nodes, edges };
}
