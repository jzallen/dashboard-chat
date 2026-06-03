/**
 * createDataCatalog — the catalog's mutable working state plus the builder that
 * projects it into a {@link LineageGraph}. Built over a {@link CatalogSource}:
 * the source supplies the static payloads, this factory resolves them once into
 * a base, layers on a runtime write side (rename / archive / restore / live-add
 * mutations held in closure state), and rebuilds the visible graph after each
 * mutation.
 *
 * The lineage query surface lives on the {@link LineageGraph} the catalog
 * hands out via {@link getSnapshot}; this factory keeps only the non-lineage
 * pass-throughs (projects, org, chats, dbt files, cold storage), the mutations,
 * and the reactivity surface. Node lookups go through the graph
 * (`getSnapshot().getNode`), which is scoped to the visible (non-archived) graph.
 *
 * Reactivity: mutations rebuild + cache a fresh LineageGraph and notify
 * subscribers, so React consumers `useSyncExternalStore(subscribe, getSnapshot)`
 * and re-render off the cached graph. The instance is referentially stable
 * across no-mutation reads (built eagerly, never lazily in getSnapshot) and
 * changes only after a mutation.
 *
 * Async-seam note: the base is read from the source ONCE at construction, not
 * inside getSnapshot. The structure is "resolved base + overlay", so a future
 * HTTP source (which can't be awaited inside getSnapshot) drops in cleanly.
 *
 * Pure: depends only on the lineage types, the LineageGraph model, and the
 * source port — never on a concrete data module. Swap the source to repoint the
 * catalog at a backend.
 */
import type { ColdStorageItem, Edge, LineageNode } from "./lineage";
import {
  build,
  type CatalogBase,
  type CatalogOverlay,
  LineageGraph,
} from "./lineageGraph";
import type { CatalogSource } from "./source";

export function createDataCatalog(source: CatalogSource) {
  /* ─── resolved base (read from the source once) ────────────────────────── */
  const base: CatalogBase = {
    nodes: source.getNodes(),
    edges: source.getEdges(),
    audit: source.getAudit(),
  };

  /* ─── mutable working state (faked against the static fixture) ─────────── */
  const overlay: CatalogOverlay = {
    renames: new Map<string, string>(),
    archivedIds: new Set<string>(),
    addedNodes: [],
    addedEdges: [],
  };
  let coldStorage: ColdStorageItem[] = [];

  /* ─── eager build + cache (referentially stable until a mutation) ──────── */
  let graph: LineageGraph = build(base, overlay);

  /* ─── reactivity ───────────────────────────────────────────────────────── */
  const listeners = new Set<() => void>();
  const notify = () => {
    graph = build(base, overlay);
    listeners.forEach((l) => l());
  };

  return {
    listProjects: () => source.getProjects(),
    getCurrentProject: () => source.getCurrentProject(),
    getOrg: () => source.getOrg(),
    listRecents: () => source.getRecents(),
    listChats: () => source.getAllChats(),

    /** Nodes added live at runtime (e.g. a mart built by chat). */
    listAddedNodes: () => overlay.addedNodes,
    /** Sources currently retired to cold storage, newest first. */
    listColdStorage: () => coldStorage,

    getChatScript: () => source.getChatScript(),
    listDbtFiles: () => source.getDbtFiles(),

    /* ─── mutations (each rebuilds the graph + notifies subscribers) ─────── */
    /** Rename a node by id; propagates to every projection that reads it. */
    renameSource: (id: string, name: string) => {
      overlay.renames.set(id, name);
      notify();
    },
    /** Add a live source node (dedup by id). */
    addSource: (node: LineageNode) => {
      if (!overlay.addedNodes.some((n) => n.id === node.id))
        overlay.addedNodes.push(node);
      notify();
    },
    /** Add a live model node and the edge feeding it (each deduped). */
    addModel: (node: LineageNode, edge: Edge) => {
      if (!overlay.addedNodes.some((n) => n.id === node.id))
        overlay.addedNodes.push(node);
      if (!overlay.addedEdges.some(([a, b]) => a === edge[0] && b === edge[1]))
        overlay.addedEdges.push(edge);
      notify();
    },
    /** Archive a source: hide it from the graph and record it in cold storage. */
    archiveSource: (src: LineageNode) => {
      overlay.archivedIds.add(src.id);
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
      overlay.archivedIds.delete(id);
      coldStorage = coldStorage.filter((s) => s.id !== id);
      notify();
    },

    /* ─── reactivity surface (for useSyncExternalStore) ──────────────────── */
    /** Register a listener; returns an unsubscribe function. */
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** The cached visible LineageGraph; a fresh instance after each mutation. */
    getSnapshot: (): LineageGraph => graph,
  };
}

export type DataCatalog = ReturnType<typeof createDataCatalog>;
