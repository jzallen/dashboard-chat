/**
 * LineageGraph — the catalog's lineage aggregate. An IMMUTABLE model of the
 * project's models and how they flow: an active DAG (nodes keyed by id, a
 * canonical edge list, and derived parent/child adjacency indices) plus a
 * separate cold-storage store of archived sources. It owns every lineage query
 * the views need AND the mutations that evolve it.
 *
 * Mutations are pure REDUCERS: `rename`/`addSource`/`addModel`/`archive`/
 * `restore` each return a NEW LineageGraph, never touching the receiver. The
 * catalog holds the current instance and swaps it; `useSyncExternalStore` sees
 * a fresh reference per change. (`now` is injected into `archive` so the model
 * stays pure — no wall clock in the domain.)
 *
 * Representation (see research notes — sparse DAG, ~100 models):
 *   - nodes:    Map<id, LineageNode>    active models, audit folded onto each
 *   - edgeList: readonly Edge[]         canonical edges; layout-ready, restore-friendly
 *   - children/parents: Map<id, id[]>   derived once in the ctor; O(degree) topology queries
 *   - cold:     Map<id, ColdStorageRecord>   archived store, retrieval-keyed by id
 * No adjacency matrix (O(V²), wrong for a sparse DAG and not what layout wants).
 *
 * Construction invariant: a LineageGraph is built only through its private
 * constructor (via {@link LineageGraph.fromSource} or a reducer), so the
 * adjacency indices are always consistent with the edge list and archived nodes
 * never leak into the active queries.
 *
 * Pure: depends only on the lineage types. No React, no data source, no layout.
 */
import type {
  AuditEntry,
  ColdStorageItem,
  Edge,
  Layer,
  LineageNode,
} from "./lineage";

/**
 * An archived source set aside in cold storage: the retired node plus the
 * edges that were incident to it (so {@link LineageGraph.restore} can re-wire
 * it losslessly), and the retirement timestamp + retention window.
 */
export interface ColdStorageRecord {
  node: LineageNode;
  edges: Edge[];
  retiredAt: number;
  retentionDays: number;
}

/**
 * The lineage slice of a catalog source — the raw payloads the graph is built
 * from. The full `CatalogSource` port structurally satisfies this; the model
 * depends only on the three getters it actually reads, not the whole catalog
 * surface (interface segregation keeps lineageGraph.ts pure and its tests light).
 */
export interface LineageSource {
  getNodes(): Record<string, LineageNode>;
  getEdges(): Edge[];
  getAudit(): Record<string, AuditEntry[]>;
}

const RETENTION_DAYS = 90;

export class LineageGraph {
  private readonly nodes: Map<string, LineageNode>;
  private readonly edgeList: readonly Edge[];
  private readonly children: Map<string, string[]>; // source id → target ids
  private readonly parents: Map<string, string[]>; // target id → source ids
  private readonly cold: Map<string, ColdStorageRecord>;
  /** Ids of nodes added at runtime (chat-built marts, fresh uploads). */
  private readonly addedIds: ReadonlySet<string>;

  private constructor(
    nodes: Map<string, LineageNode>,
    edgeList: readonly Edge[],
    cold: Map<string, ColdStorageRecord>,
    addedIds: ReadonlySet<string>,
  ) {
    this.nodes = nodes;
    this.edgeList = edgeList;
    this.cold = cold;
    this.addedIds = addedIds;

    // Derive the adjacency indices once, in edge order (so parentsOf/childrenOf
    // preserve edge order). Dangling entries (an edge whose endpoint is absent)
    // are harmless: queries resolve ids through `nodes` and drop misses.
    const children = new Map<string, string[]>();
    const parents = new Map<string, string[]>();
    for (const [from, to] of edgeList) {
      (children.get(from) ?? children.set(from, []).get(from)!).push(to);
      (parents.get(to) ?? parents.set(to, []).get(to)!).push(from);
    }
    this.children = children;
    this.parents = parents;
  }

  /**
   * Build the initial graph from a {@link LineageSource}'s payloads. Folds the
   * audit trail onto each node; starts with empty cold storage and no
   * runtime-added ids.
   */
  static fromSource(source: LineageSource): LineageGraph {
    const nodes = source.getNodes();
    const audit = source.getAudit();
    const folded = new Map<string, LineageNode>();
    for (const n of Object.values(nodes)) {
      folded.set(n.id, { ...n, audit: audit[n.id] ?? n.audit });
    }
    return new LineageGraph(folded, [...source.getEdges()], new Map(), new Set());
  }

  /* ─── reads (active DAG only — archived nodes are structurally invisible) ── */

  /** The node for `id`, or undefined if absent/archived. */
  getNode(id: string): LineageNode | undefined {
    return this.nodes.get(id);
  }

  /** All active nodes, for iteration (e.g. the DAG render). */
  allNodes(): LineageNode[] {
    return [...this.nodes.values()];
  }

  /** All active edges, for iteration (e.g. the DAG render). Read-only. */
  allEdges(): readonly Edge[] {
    return this.edgeList;
  }

  /** Upstream nodes feeding `id`, in edge order. */
  parentsOf(id: string): LineageNode[] {
    return (this.parents.get(id) ?? [])
      .map((pid) => this.nodes.get(pid))
      .filter((n): n is LineageNode => Boolean(n));
  }

  /** Downstream nodes that `id` feeds, in edge order. */
  childrenOf(id: string): LineageNode[] {
    return (this.children.get(id) ?? [])
      .map((cid) => this.nodes.get(cid))
      .filter((n): n is LineageNode => Boolean(n));
  }

  /** Non-source nodes that carry a model ref (datasets, views, reports). */
  models(): LineageNode[] {
    return this.allNodes().filter((n) => n.layer !== "source" && n.ref);
  }

  /** All active nodes in the given pipeline `layer`. */
  nodesInLayer(layer: Layer): LineageNode[] {
    return this.allNodes().filter((n) => n.layer === layer);
  }

  /** Ids of non-source nodes with no incoming edge — dangling, unconnected models. */
  orphans(): Set<string> {
    const orphans = new Set<string>();
    for (const n of this.nodes.values()) {
      if (n.layer !== "source" && !this.parents.get(n.id)?.length) {
        orphans.add(n.id);
      }
    }
    return orphans;
  }

  /** True if a direct edge connects `a` and `b` in either direction. */
  isAdjacent(a: string, b: string): boolean {
    return (
      (this.children.get(a)?.includes(b) ?? false) ||
      (this.children.get(b)?.includes(a) ?? false)
    );
  }

  /** The folded AI audit trail for a node; [] when none recorded. */
  auditFor(id: string): AuditEntry[] {
    return this.getNode(id)?.audit ?? [];
  }

  /** Number of AI audit entries recorded against a node. */
  auditCount(id: string): number {
    return this.auditFor(id).length;
  }

  /** Active nodes that were added at runtime (resolves only the still-active ones). */
  addedNodes(): LineageNode[] {
    return [...this.addedIds]
      .map((id) => this.nodes.get(id))
      .filter((n): n is LineageNode => Boolean(n));
  }

  /** Archived sources, newest-first, projected to the list/restore DTO. */
  coldStorage(): ColdStorageItem[] {
    return [...this.cold.values()]
      .sort((a, b) => b.retiredAt - a.retiredAt)
      .map((r) => ({
        id: r.node.id,
        name: r.node.label,
        schema: r.node.schema,
        files: r.node.files,
        retiredAt: r.retiredAt,
        retentionDays: r.retentionDays,
      }));
  }

  /* ─── reducers (each returns a NEW LineageGraph; no-ops return `this`) ───── */

  /** Relabel an active node. */
  rename(id: string, label: string): LineageGraph {
    const node = this.nodes.get(id);
    if (!node) return this;
    const nodes = new Map(this.nodes);
    nodes.set(id, { ...node, label });
    return new LineageGraph(nodes, this.edgeList, this.cold, this.addedIds);
  }

  /** Add a live source node (dedup by id). */
  addSource(node: LineageNode): LineageGraph {
    if (this.nodes.has(node.id)) return this;
    const nodes = new Map(this.nodes);
    nodes.set(node.id, node);
    const addedIds = new Set(this.addedIds).add(node.id);
    return new LineageGraph(nodes, this.edgeList, this.cold, addedIds);
  }

  /** Add a live model node and the edge feeding it (each deduped). */
  addModel(node: LineageNode, edge: Edge): LineageGraph {
    const nodes = new Map(this.nodes);
    if (!nodes.has(node.id)) nodes.set(node.id, node);
    const hasEdge = this.edgeList.some(
      ([a, b]) => a === edge[0] && b === edge[1],
    );
    const edgeList = hasEdge ? this.edgeList : [...this.edgeList, edge];
    const addedIds = new Set(this.addedIds).add(node.id);
    return new LineageGraph(nodes, edgeList, this.cold, addedIds);
  }

  /**
   * Archive a source: move it (and its incident edges) out of the active DAG
   * into cold storage, stamped with `now`. The stashed edges let `restore`
   * re-wire it losslessly.
   */
  archive(id: string, now: number): LineageGraph {
    const node = this.nodes.get(id);
    if (!node) return this;
    const incident = this.edgeList.filter(([a, b]) => a === id || b === id);
    const nodes = new Map(this.nodes);
    nodes.delete(id);
    const edgeList = this.edgeList.filter(([a, b]) => a !== id && b !== id);
    const cold = new Map(this.cold);
    cold.set(id, {
      node,
      edges: incident,
      retiredAt: now,
      retentionDays: RETENTION_DAYS,
    });
    return new LineageGraph(nodes, edgeList, cold, this.addedIds);
  }

  /**
   * Restore an archived source: bring its node back into the active DAG and
   * re-add its stashed incident edges (deduped). An edge to a still-archived
   * node sits dangling until that node is also restored — harmless, since
   * queries resolve through the node map.
   */
  restore(id: string): LineageGraph {
    const record = this.cold.get(id);
    if (!record) return this;
    const nodes = new Map(this.nodes);
    nodes.set(id, record.node);
    const edgeList = [...this.edgeList];
    for (const e of record.edges) {
      if (!edgeList.some(([a, b]) => a === e[0] && b === e[1])) {
        edgeList.push(e);
      }
    }
    const cold = new Map(this.cold);
    cold.delete(id);
    return new LineageGraph(nodes, edgeList, cold, this.addedIds);
  }
}
