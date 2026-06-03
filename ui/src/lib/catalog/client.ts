/**
 * createDataCatalog — a thin reactive shell around a {@link LineageGraph}
 * aggregate, built over a {@link CatalogSource}. The source supplies the raw
 * payloads (read once at construction into the initial graph); this factory
 * holds the current immutable graph, applies reducers to it on each mutation,
 * and notifies subscribers.
 *
 * The graph is a PRIVATE implementation detail: nothing outside this module
 * touches a LineageGraph. The catalog re-exposes the lineage queries it needs as
 * its own methods (getNode, getNodesByLayer, listNodes, parentsOf, …), each
 * delegating to the internal graph. Consumers depend on the catalog, never on
 * the model.
 *
 * Reactivity: every mutation swaps in the reducer's new graph and bumps a
 * version counter. React consumers `useSyncExternalStore(subscribe, getSnapshot)`
 * where getSnapshot returns that version — an opaque change token, not the graph.
 * A no-op reducer returns the same instance, so the version (and references) stay
 * stable and no spurious re-render fires.
 *
 * `Date.now()` is injected into `archive` here — the wall clock lives in this
 * adapter shell, never in the pure graph reducer.
 *
 * Pure core: the graph and its reducers depend only on the lineage types and
 * the source port. Swap the source to repoint the catalog at a backend.
 */
import type { Edge, Layer, LineageNode } from "./lineage";
import { LineageGraph } from "./lineageGraph";
import type { CatalogSource } from "./source";

export function createDataCatalog(source: CatalogSource) {
  let graph = LineageGraph.fromSource(source);
  let version = 0;

  const listeners = new Set<() => void>();
  /** Swap in a new graph, bump the version, and notify; skip no-op reducers. */
  const commit = (next: LineageGraph) => {
    if (next === graph) return;
    graph = next;
    version++;
    listeners.forEach((l) => l());
  };

  return {
    listProjects: () => source.getProjects(),
    getCurrentProject: () => source.getCurrentProject(),
    getOrg: () => source.getOrg(),
    listRecents: () => source.getRecents(),
    listChats: () => source.getAllChats(),
    getChatScript: () => source.getChatScript(),
    listDbtFiles: () => source.getDbtFiles(),

    /* ─── lineage reads (delegated to the private graph) ─────────────────── */
    /** A node by id from the visible graph, or undefined if absent/archived. */
    getNode: (id: string) => graph.getNode(id),
    /** All active nodes. */
    listNodes: () => graph.allNodes(),
    /** All active edges. */
    listEdges: () => graph.allEdges(),
    /** Active nodes in a given pipeline layer. */
    getNodesByLayer: (layer: Layer) => graph.nodesInLayer(layer),
    /** Non-source nodes that carry a model ref (datasets, views, reports). */
    listModels: () => graph.models(),
    /** Upstream nodes feeding `id`, in edge order. */
    parentsOf: (id: string) => graph.parentsOf(id),
    /** Downstream nodes that `id` feeds, in edge order. */
    childrenOf: (id: string) => graph.childrenOf(id),
    /** Ids of non-source nodes with no incoming edge. */
    orphans: () => graph.orphans(),
    /** True if a direct edge connects `a` and `b` in either direction. */
    isAdjacent: (a: string, b: string) => graph.isAdjacent(a, b),
    /** The folded AI audit trail for a node; [] when none recorded. */
    auditFor: (id: string) => graph.auditFor(id),
    /** Number of AI audit entries recorded against a node. */
    auditCount: (id: string) => graph.auditCount(id),
    /** Nodes added live at runtime (e.g. a mart built by chat). */
    listAddedNodes: () => graph.addedNodes(),
    /** Sources currently retired to cold storage, newest first. */
    listColdStorage: () => graph.coldStorage(),

    /* ─── mutation commands (each applies a reducer + notifies) ───────────── */
    /** Rename a node by id; propagates to every projection that reads it. */
    renameSource: (id: string, name: string) => commit(graph.rename(id, name)),
    /** Add a live source node (dedup by id). */
    addSource: (node: LineageNode) => commit(graph.addSource(node)),
    /** Add a live model node and the edge feeding it (each deduped). */
    addModel: (node: LineageNode, edge: Edge) =>
      commit(graph.addModel(node, edge)),
    /** Archive a source: hide it from the graph and record it in cold storage. */
    archiveSource: (src: LineageNode) =>
      commit(graph.archive(src.id, Date.now())),
    /** Restore an archived source: bring it back and drop it from cold storage. */
    restoreSource: (id: string) => commit(graph.restore(id)),

    /* ─── reactivity surface (for useSyncExternalStore) ──────────────────── */
    /** Register a listener; returns an unsubscribe function. */
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Opaque store version — bumps on every mutation; a memo/dep token. */
    getSnapshot: (): number => version,
  };
}

export type DataCatalog = ReturnType<typeof createDataCatalog>;
