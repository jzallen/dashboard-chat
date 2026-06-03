/**
 * LineageGraph — the catalog's lineage domain model. An immutable,
 * framework-agnostic view of the visible pipeline: nodes (archived excluded,
 * renames applied, audit folded onto each node) plus the directed edges between
 * them. It owns every topology query the views need — parents/children,
 * layer membership, orphans, adjacency — plus the folded audit lookups.
 *
 * Construction invariant: a LineageGraph is assembled ONLY by {@link build}
 * (the catalog's builder). By the time the constructor runs, edges already
 * reference present nodes, labels are current, archived nodes are gone, and
 * each node's `audit` is the folded trail. Callers therefore never re-filter,
 * re-merge, or re-derive a traversal — they ask the graph.
 *
 * Pure: depends only on the lineage types. No React, no data source.
 */
import type { AuditEntry, Edge, Layer, LineageNode } from "./lineage";

/**
 * The catalog's mutable overlay, resolved against its base payloads. {@link build}
 * merges this into the visible graph; the catalog owns the live state, this
 * module owns the assembly.
 */
export interface CatalogOverlay {
  renames: Map<string, string>;
  archivedIds: Set<string>;
  addedNodes: LineageNode[];
  addedEdges: Edge[];
}

/** The resolved base read once from the source: the raw nodes/edges/audit. */
export interface CatalogBase {
  nodes: Record<string, LineageNode>;
  edges: Edge[];
  audit: Record<string, AuditEntry[]>;
}

/**
 * Every node — base plus live-added — with renames applied (id → label) and the
 * source audit folded onto each node (`node.audit = audit[id] ?? node.audit`).
 * Does NOT exclude archived nodes: this is the working state the catalog exposes
 * through `getNode`, which stays archived-inclusive.
 */
export function buildWorkingNodes(
  base: CatalogBase,
  overlay: CatalogOverlay,
): Record<string, LineageNode> {
  const merged: Record<string, LineageNode> = {
    ...base.nodes,
    ...Object.fromEntries(overlay.addedNodes.map((n) => [n.id, n])),
  };
  const working: Record<string, LineageNode> = {};
  Object.values(merged).forEach((n) => {
    const label = overlay.renames.get(n.id) ?? n.label;
    const audit = base.audit[n.id] ?? n.audit;
    working[n.id] = { ...n, label, audit };
  });
  return working;
}

/**
 * Assemble the visible {@link LineageGraph} from the resolved base + overlay:
 * take the working nodes (renames applied, audit folded), drop the archived
 * ones, drop any edge touching an archived id, then hand the assembled
 * {nodes, edges} to the constructor.
 */
export function build(base: CatalogBase, overlay: CatalogOverlay): LineageGraph {
  const working = buildWorkingNodes(base, overlay);
  const nodes: Record<string, LineageNode> = {};
  Object.values(working).forEach((n) => {
    if (!overlay.archivedIds.has(n.id)) nodes[n.id] = n;
  });
  const edges = [...base.edges, ...overlay.addedEdges].filter(
    ([a, b]) => !overlay.archivedIds.has(a) && !overlay.archivedIds.has(b),
  );
  return new LineageGraph(nodes, edges);
}

export class LineageGraph {
  /**
   * @param nodes Visible nodes keyed by id (archived excluded, renames applied,
   *   audit folded). Public-read so the geometry layer + DAG render can iterate.
   * @param edges Directed edges between present nodes. Public-read for the same.
   */
  constructor(
    public readonly nodes: Record<string, LineageNode>,
    public readonly edges: Edge[],
  ) {}

  /** Upstream nodes feeding `id`, in edge order. */
  parentsOf(id: string): LineageNode[] {
    return this.edges
      .filter(([, b]) => b === id)
      .map(([a]) => this.nodes[a])
      .filter(Boolean);
  }

  /** Downstream nodes that `id` feeds, in edge order. */
  childrenOf(id: string): LineageNode[] {
    return this.edges
      .filter(([a]) => a === id)
      .map(([, b]) => this.nodes[b])
      .filter(Boolean);
  }

  /** Non-source nodes that carry a model ref (datasets, views, reports). */
  models(): LineageNode[] {
    return Object.values(this.nodes).filter(
      (n) => n.layer !== "source" && n.ref,
    );
  }

  /** All nodes in the given pipeline `layer`. */
  nodesInLayer(layer: Layer): LineageNode[] {
    return Object.values(this.nodes).filter((n) => n.layer === layer);
  }

  /** Ids of non-source nodes with no incoming edge — dangling, unconnected models. */
  orphans(): Set<string> {
    const hasIncoming = new Set(this.edges.map(([, b]) => b));
    const orphans = new Set<string>();
    Object.values(this.nodes).forEach((n) => {
      if (n.layer !== "source" && !hasIncoming.has(n.id)) orphans.add(n.id);
    });
    return orphans;
  }

  /** True if a direct edge connects `a` and `b` in either direction. */
  isAdjacent(a: string, b: string): boolean {
    return this.edges.some(
      ([from, to]) => (from === a && to === b) || (from === b && to === a),
    );
  }

  /** The node for `id` from the visible graph, or undefined if absent/archived. */
  getNode(id: string): LineageNode | undefined {
    return this.nodes[id];
  }

  /** The folded AI audit trail for a node; [] when none recorded. */
  auditFor(id: string): AuditEntry[] {
    return this.getNode(id)?.audit ?? [];
  }

  /** Number of AI audit entries recorded against a node. */
  auditCount(id: string): number {
    return this.auditFor(id).length;
  }
}
