/**
 * createDataCatalog — the catalog's query surface AND its mutable working
 * state, built over a {@link CatalogSource}. Components read the catalog through
 * the object this returns; the source supplies the static payloads and this
 * factory layers on the projections (lineage graph assembly, audit counts,
 * model filtering) plus a runtime write side: rename / archive / restore /
 * live-add mutations held in module-closure state.
 *
 * Reactivity: mutations bump a version counter and notify subscribers, so React
 * consumers can `useSyncExternalStore(subscribe, getSnapshot)` and re-render off
 * the catalog directly — no overlay props threaded through the tree.
 *
 * Pure: depends only on the lineage types and the source port — never on a
 * concrete data module. Swap the source to repoint the catalog at a backend.
 */
import type { ColdStorageItem, Edge, Graph, LineageNode } from "./lineage";
import type { CatalogSource } from "./source";

export function createDataCatalog(source: CatalogSource) {
  /* ─── mutable working state (faked against the static fixture) ─────────── */
  const renames = new Map<string, string>();
  const archivedIds = new Set<string>();
  const addedNodes: LineageNode[] = [];
  const addedEdges: Edge[] = [];
  let coldStorage: ColdStorageItem[] = [];

  /* ─── reactivity ───────────────────────────────────────────────────────── */
  let version = 0;
  const listeners = new Set<() => void>();
  const notify = () => {
    version++;
    listeners.forEach((l) => l());
  };

  /**
   * Every node — static source nodes plus live-added ones — with renames
   * applied (id → label). Does NOT exclude archived nodes; callers that need
   * the visible graph filter those out themselves (see {@link lineageGraph}).
   */
  function allNodes(): Record<string, LineageNode> {
    const merged: Record<string, LineageNode> = {
      ...source.getNodes(),
      ...Object.fromEntries(addedNodes.map((n) => [n.id, n])),
    };
    renames.forEach((label, id) => {
      if (merged[id]) merged[id] = { ...merged[id], label };
    });
    return merged;
  }

  /**
   * Assemble the visible graph from the working state: every node minus the
   * archived ones, and every edge (static + live-added) minus any touching an
   * archived id.
   */
  function lineageGraph(): Graph {
    const all = allNodes();
    const nodes: Record<string, LineageNode> = {};
    Object.values(all).forEach((n) => {
      if (!archivedIds.has(n.id)) nodes[n.id] = n;
    });
    const edges = [...source.getEdges(), ...addedEdges].filter(
      ([a, b]) => !archivedIds.has(a) && !archivedIds.has(b),
    );
    return { nodes, edges };
  }

  return {
    listProjects: () => source.getProjects(),
    getCurrentProject: () => source.getCurrentProject(),
    getOrg: () => source.getOrg(),
    listRecents: () => source.getRecents(),
    listChats: () => source.getAllChats(),

    /* ─── reads (off the working state) ──────────────────────────────────── */
    getNode: (id: string) => allNodes()[id],
    listNodes: () => Object.values(allNodes()),
    /** Non-source nodes that carry a model ref (datasets, views, reports). */
    listModels: () =>
      Object.values(allNodes()).filter((n) => n.layer !== "source" && n.ref),
    /** Nodes added live at runtime (e.g. a mart built by chat). */
    listAddedNodes: () => addedNodes,
    /** Sources currently retired to cold storage, newest first. */
    listColdStorage: () => coldStorage,
    /**
     * Upstream nodes feeding `id`, in edge order — resolved over the working
     * state so renames and live-added edges propagate here too (not just the
     * static source).
     */
    parentsOf: (id: string): LineageNode[] => {
      const nodes = allNodes();
      return [...source.getEdges(), ...addedEdges]
        .filter(([, b]) => b === id)
        .map(([a]) => nodes[a])
        .filter(Boolean);
    },
    getEdges: () => source.getEdges(),

    /** The recorded AI audit trail for a node (undefined if none recorded). */
    auditFor: (id: string) => source.getAudit()[id],
    /** Number of AI audit entries recorded against a node. */
    auditCount: (id: string) => (source.getAudit()[id] || []).length,

    lineageGraph,
    getChatScript: () => source.getChatScript(),
    listDbtFiles: () => source.getDbtFiles(),

    /* ─── mutations (each notifies subscribers) ──────────────────────────── */
    /** Rename a node by id; propagates to every projection that reads it. */
    renameSource: (id: string, name: string) => {
      renames.set(id, name);
      notify();
    },
    /** Add a live source node (dedup by id). */
    addSource: (node: LineageNode) => {
      if (!addedNodes.some((n) => n.id === node.id)) addedNodes.push(node);
      notify();
    },
    /** Add a live model node and the edge feeding it (each deduped). */
    addModel: (node: LineageNode, edge: Edge) => {
      if (!addedNodes.some((n) => n.id === node.id)) addedNodes.push(node);
      if (!addedEdges.some(([a, b]) => a === edge[0] && b === edge[1]))
        addedEdges.push(edge);
      notify();
    },
    /** Archive a source: hide it from the graph and record it in cold storage. */
    archiveSource: (src: LineageNode) => {
      archivedIds.add(src.id);
      coldStorage = [
        {
          id: src.id,
          name: src.label,
          schema: src.schema,
          files: src.files,
          retiredAt: Date.now(),
          retentionDays: 90,
        },
        ...coldStorage.filter((x) => x.id !== src.id),
      ];
      notify();
    },
    /** Restore an archived source: bring it back and drop it from cold storage. */
    restoreSource: (id: string) => {
      archivedIds.delete(id);
      coldStorage = coldStorage.filter((s) => s.id !== id);
      notify();
    },

    /* ─── reactivity surface (for useSyncExternalStore) ──────────────────── */
    /** Register a listener; returns an unsubscribe function. */
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Monotonic version counter — bumps on every mutation. */
    getSnapshot: (): number => version,
  };
}

export type DataCatalog = ReturnType<typeof createDataCatalog>;
