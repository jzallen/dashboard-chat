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
 * Representation (sized for a sparse DAG of ~100 models):
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
  ModelKind,
} from "./lineage";
import type { Model } from "./models";

const MODEL_KINDS: readonly ModelKind[] = ["dataset", "view", "report"];

function isModelKind(kind: unknown): kind is ModelKind {
  return typeof kind === "string" && MODEL_KINDS.includes(kind as ModelKind);
}

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
   * Build the initial graph from already-resolved payloads (the synchronous
   * core). Folds the audit trail onto each node; starts with empty cold storage
   * and no runtime-added ids. {@link createDataCatalog} awaits the async source
   * getters once and feeds the resolved data here, keeping the graph itself
   * fully synchronous and free of any data-source/promise dependency.
   */
  static from(
    nodes: Record<string, LineageNode>,
    edges: Edge[],
    audit: Record<string, AuditEntry[]>,
  ): LineageGraph {
    const folded = new Map<string, LineageNode>();
    for (const n of Object.values(nodes)) {
      folded.set(n.id, { ...n, audit: audit[n.id] ?? n.audit });
    }
    return new LineageGraph(folded, [...edges], new Map(), new Set());
  }

  /**
   * Build the initial graph from a synchronous {@link LineageSource}'s payloads.
   * A thin convenience over {@link LineageGraph.from} for sources whose getters
   * are still synchronous (e.g. unit-test fixtures).
   */
  static fromSource(source: LineageSource): LineageGraph {
    return LineageGraph.from(
      source.getNodes(),
      source.getEdges(),
      source.getAudit(),
    );
  }

  /**
   * Build the initial graph with pre-seeded cold storage records — the loader
   * path. Archived datasets derived by the server loader are seeded directly
   * rather than relying on client optimistic state, so the Cold Storage drawer
   * reflects server truth on the first render. Active nodes in `nodes` take
   * precedence: an id that appears in both `nodes` and `coldRecords` is treated as
   * active (the server un-archived it between requests).
   */
  static fromWithCold(
    nodes: Record<string, LineageNode>,
    edges: Edge[],
    audit: Record<string, AuditEntry[]>,
    coldRecords: ColdStorageRecord[],
  ): LineageGraph {
    const g = LineageGraph.from(nodes, edges, audit);
    if (coldRecords.length === 0) return g;
    const cold = new Map<string, ColdStorageRecord>();
    for (const rec of coldRecords) {
      if (!g.nodes.has(rec.node.id)) {
        cold.set(rec.node.id, rec);
      }
    }
    if (cold.size === 0) return g;
    return new LineageGraph(g.nodes, g.edgeList, cold, g.addedIds);
  }

  /* ─── reads (active DAG only — archived nodes are structurally invisible) ── */

  /** The node for `id`, or undefined if absent/archived. */
  getNode(id: string): LineageNode | undefined {
    return this.nodes.get(id);
  }

  /**
   * The typed {@link Model} projection of a node's `ref`, or `undefined` when
   * the node is absent/archived, carries no model ref, or bears an unrecognised
   * `kind`. The domain owns this node→`Model` narrowing so presentation receives
   * a discriminated `Model` and never casts off a loose node: a runtime check on
   * `ref.kind` gates the projection, and every non-narrowable case degrades to
   * `undefined` rather than a mis-typed dereference.
   *
   * Deliberately lightweight — a discriminant check, not full schema validation
   * (no Zod in this layer). It trusts the field set behind a recognised `kind`.
   */
  getModel(id: string): Model | undefined {
    const ref = this.nodes.get(id)?.ref;
    if (!ref || !isModelKind(ref.kind)) return undefined;
    return ref as unknown as Model;
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

  /**
   * Ids of non-root nodes with no incoming edge — dangling, unconnected models.
   * Root layers (`source`, `staging`) legitimately have no parents: source
   * uploads and staging datasets are the graph's entry points, so they are
   * never orphans. Only `intermediate`/`mart` nodes with no inputs are.
   */
  orphans(): Set<string> {
    const orphans = new Set<string>();
    for (const n of this.nodes.values()) {
      if (
        n.layer !== "source" &&
        n.layer !== "staging" &&
        !this.parents.get(n.id)?.length
      ) {
        orphans.add(n.id);
      }
    }
    return orphans;
  }

  /**
   * Ids of active nodes that should render disabled-but-visible (greyed, still
   * on the canvas). Superset of {@link orphans}: every structural orphan PLUS a
   * `staging` node that has lost its only source ingress — one whose feeding
   * source has been archived (its incident source→staging edge now sits in a
   * cold-storage record) and which has no remaining active parent.
   *
   * Unlike {@link orphans}, which treats every staging node as a legitimate
   * graph root and never dims it, this captures a downstream staging node whose
   * source was moved to cold storage: the node stays visible for later remap but
   * is flagged disabled. A staging root that never had an archived source is NOT
   * included (no cold record points at it), so genuine entry points are untouched.
   */
  disabledNodes(): Set<string> {
    const disabled = this.orphans();
    const targetsWithArchivedIngress = new Set<string>();
    for (const record of this.cold.values()) {
      for (const [, to] of record.edges) {
        targetsWithArchivedIngress.add(to);
      }
    }
    for (const n of this.nodes.values()) {
      if (n.layer !== "staging") continue;
      if (this.parents.get(n.id)?.length) continue; // still has a live ingress
      if (targetsWithArchivedIngress.has(n.id)) disabled.add(n.id);
    }
    return disabled;
  }

  /** True if a direct edge connects nodes `a` and `b` in either direction. */
  isNodeAdjacent(a: string, b: string): boolean {
    return (
      (this.children.get(a)?.includes(b) ?? false) ||
      (this.children.get(b)?.includes(a) ?? false)
    );
  }

  /** True if `edge` is incident to `nodeId` (the node is one of its endpoints). */
  isEdgeAdjacent(edge: Edge, nodeId: string): boolean {
    return edge[0] === nodeId || edge[1] === nodeId;
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

  /**
   * Set a node's dbt machine name (`modelName`). DECOUPLED from {@link rename}
   * (which edits `label`/display name): this touches only `modelName`. Returns
   * `this` (a referential no-op) when the node is absent or the value is
   * unchanged so the commit guard suppresses a spurious render.
   */
  withModelName(id: string, modelName: string): LineageGraph {
    const node = this.nodes.get(id);
    if (!node) return this;
    if (node.modelName === modelName) return this;
    const nodes = new Map(this.nodes);
    nodes.set(id, { ...node, modelName });
    return new LineageGraph(nodes, this.edgeList, this.cold, this.addedIds);
  }

  /**
   * Flip the `enabled` flag of a node's matching {@link AuditEntry} (keyed by
   * `auditEntryId`). Mirrors the other reducers: returns `this` (a referential
   * no-op) when the node, the entry, or the value is unchanged, so the catalog's
   * commit no-op guard suppresses a spurious render. The audit array and the
   * touched entry are copied; siblings keep their identity.
   */
  withAuditToggled(
    nodeId: string,
    auditEntryId: string,
    enabled: boolean,
  ): LineageGraph {
    const node = this.nodes.get(nodeId);
    if (!node?.audit) return this;
    const index = node.audit.findIndex((e) => e.auditEntryId === auditEntryId);
    if (index === -1) return this;
    if (node.audit[index].enabled === enabled) return this;
    const audit = node.audit.map((entry, i) =>
      i === index ? { ...entry, enabled } : entry,
    );
    const nodes = new Map(this.nodes);
    nodes.set(nodeId, { ...node, audit });
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

  /**
   * Remove a node and its incident edges outright — the optimistic-rollback
   * counterpart of {@link addSource}. Unlike {@link archive} it does NOT retire
   * the node to cold storage; an optimistic node that never landed is discarded,
   * not restorable. Absent id → the same instance (no-op).
   */
  removeSource(id: string): LineageGraph {
    if (!this.nodes.has(id)) return this;
    const nodes = new Map(this.nodes);
    nodes.delete(id);
    const edgeList = this.edgeList.filter(([a, b]) => a !== id && b !== id);
    const addedIds = new Set(this.addedIds);
    addedIds.delete(id);
    return new LineageGraph(nodes, edgeList, this.cold, addedIds);
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

  /**
   * Carry another graph's cold-storage store onto this one. A server
   * revalidation rebuilds the active DAG from scratch via {@link from}, which
   * starts with EMPTY cold storage — so a write-triggered revalidation (e.g.
   * the revalidate-after-archive) would otherwise evict every archived source
   * from the Cold Storage drawer. Merging the prior cold map back in keeps the
   * drawer intact across the rebuild. Active nodes win: an id the rebuilt DAG
   * now lists as live is dropped from the carried-over cold store (server truth
   * says it is no longer archived). Returns `this` (a referential no-op) when
   * nothing is carried over, so the catalog's commit guard suppresses a
   * spurious render. NOT for project switches — cold storage is per-project and
   * resets on switch (only same-scope, write-triggered revalidations preserve it).
   */
  withColdStorageFrom(prior: LineageGraph): LineageGraph {
    let changed = false;
    const cold = new Map(this.cold);
    for (const [id, record] of prior.cold) {
      if (this.nodes.has(id)) continue; // active wins — no longer archived
      if (cold.get(id) === record) continue;
      cold.set(id, record);
      changed = true;
    }
    return changed
      ? new LineageGraph(this.nodes, this.edgeList, cold, this.addedIds)
      : this;
  }
}
