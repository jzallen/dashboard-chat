// Lineage dependency derivation — pure core (MR-5).
//
// Suite authored by DISTILL (path-forward.md §2.5 dependency strip); body
// implemented at DELIVER. Reuses the MR-2 lineage builder: given a built
// LineageGraph and a model id, return that model's immediate upstream
// (producers) and downstream (consumers) nodes — the data the model-detail
// dependency strip links to (/table/:id, /view/:id, /report/:id).
//
// Framework-free and testable in isolation. RED scaffold (created by DISTILL).
import type { LineageGraph, LineageNode } from "./buildGraph";

export const __SCAFFOLD__ = true;

export interface ModelDependencies {
  /** Immediate producers — nodes with an edge `{ from: node, to: modelId }`. */
  upstream: LineageNode[];
  /** Immediate consumers — nodes with an edge `{ from: modelId, to: node }`. */
  downstream: LineageNode[];
}

/**
 * Derive a model's immediate upstream/downstream dependency nodes from the
 * lineage graph. Node order follows `graph.nodes`; each direction is deduped.
 */
export function deriveModelDependencies(
  _modelId: string,
  _graph: LineageGraph,
): ModelDependencies {
  throw new Error(
    "Not yet implemented — RED scaffold (MR-5 deriveModelDependencies)",
  );
}
