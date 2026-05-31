// Lineage graph builder — pure core (MR-2).
//
// RED scaffold authored by DISTILL (path-forward.md §2.1/§4.5). DELIVER replaces
// the body with the real derivation and removes the __SCAFFOLD__ marker.
//
// `buildGraph` derives a layered lineage DAG from the dataCatalog REST data
// (datasets / views / reports) — NOT from ui-state. It is framework-free and
// testable in isolation. Orphan detection lives here (the single source of truth):
// a non-root node whose inputs are all absent-or-archived is an orphan.
export const __SCAFFOLD__ = true;

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
  _datasets: readonly LineageDatasetInput[],
  _views: readonly View[],
  _reports: readonly Report[],
  _archived: ReadonlySet<string>,
): LineageGraph {
  throw new Error("Not yet implemented — RED scaffold (lineage MR-2)");
}
