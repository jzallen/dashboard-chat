// Lineage dependency derivation — pure core (MR-5).
//
// Reuses the MR-2 lineage builder: given a built LineageGraph and a model id,
// return that model's immediate upstream (producers) and downstream (consumers)
// nodes — the data the model-detail dependency strip links to
// (/table/:id, /view/:id, /report/:id). Framework-free and testable in isolation.
import type { LineageGraph, LineageNode } from "./buildGraph";

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
  modelId: string,
  graph: LineageGraph,
): ModelDependencies {
  const upstreamIds = new Set<string>();
  const downstreamIds = new Set<string>();

  for (const edge of graph.edges) {
    if (edge.to === modelId) upstreamIds.add(edge.from);
    if (edge.from === modelId) downstreamIds.add(edge.to);
  }

  const inOrder = (ids: ReadonlySet<string>): LineageNode[] =>
    graph.nodes.filter((node) => ids.has(node.id));

  return { upstream: inOrder(upstreamIds), downstream: inOrder(downstreamIds) };
}
