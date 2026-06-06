/**
 * createDataCatalog — a reactive snapshot store over the catalog payloads,
 * composed from a PRIMARY source and a complete FALLBACK source, modelled as
 * **stale-while-revalidate**.
 *
 * The held snapshot is the whole resolved catalog state: the {@link LineageGraph}
 * aggregate plus the seven non-lineage payloads (projects, currentProject, org,
 * recents, chats, chatScript, dbtFiles). `commit(partial)` merges any subset
 * into the snapshot and bumps a version counter; mutations are just
 * `commit({ graph: reducer(snapshot.graph) })` — the same reactive channel real
 * data streams in through.
 *
 * Construction (async): SEED the snapshot from the `fallback` (await its ten
 * getters — instant for a local fixture, then build the graph synchronously via
 * {@link LineageGraph.from}) and return immediately, so the app mounts instantly.
 * Then REVALIDATE in the background: for each getter the `primary` implements,
 * `primary.getX().then(v => commit({ x: v })).catch(keepFallback)` — real backend
 * data lands as reactive updates, and a rejection silently keeps the fallback
 * value. The primary never references the fallback.
 *
 * All read methods stay SYNCHRONOUS off the snapshot; consumers depend on the
 * catalog, never on a promise or the internal graph.
 *
 * Reactivity: every commit bumps the version; React consumers
 * `useSyncExternalStore(subscribe, getSnapshot)` where getSnapshot returns that
 * version — an opaque change token. A no-op graph reducer returns the same
 * instance, so commit({ graph }) is dropped and no spurious re-render fires.
 *
 * `Date.now()` is injected into `archive` here — the wall clock lives in this
 * adapter shell, never in the pure graph reducer.
 */
import type {
  CatalogSource,
  PartialCatalogSource,
} from "./dataSources/source";
import type { Edge, Layer, LineageNode } from "./lineage";
import { LineageGraph } from "./lineageGraph";
import type {
  ChatHistoryItem,
  ChatScript,
  CurrentProject,
  DbtFile,
  OrgSettings,
  ProjectSummary,
} from "./models";

/**
 * The full resolved catalog state the reactive store holds. The lineage payloads
 * are folded into the {@link LineageGraph}; the seven non-lineage payloads are
 * served straight off the snapshot.
 */
interface CatalogSnapshot {
  graph: LineageGraph;
  projects: ProjectSummary[];
  currentProject: CurrentProject;
  org: OrgSettings;
  recents: ChatHistoryItem[];
  chats: ChatHistoryItem[];
  chatScript: ChatScript;
  dbtFiles: DbtFile[];
}

export async function createDataCatalog(
  primary: PartialCatalogSource,
  fallback: CatalogSource,
) {
  // SEED from the complete fallback (instant for a local fixture). Build the
  // initial graph synchronously from the resolved lineage payloads.
  const [
    projects,
    currentProject,
    org,
    recents,
    chats,
    nodes,
    edges,
    audit,
    chatScript,
    dbtFiles,
  ] = await Promise.all([
    fallback.getProjects(),
    fallback.getCurrentProject(),
    fallback.getOrg(),
    fallback.getRecents(),
    fallback.getAllChats(),
    fallback.getNodes(),
    fallback.getEdges(),
    fallback.getAudit(),
    fallback.getChatScript(),
    fallback.getDbtFiles(),
  ]);

  let snapshot: CatalogSnapshot = {
    graph: LineageGraph.from(nodes, edges, audit),
    projects,
    currentProject,
    org,
    recents,
    chats,
    chatScript,
    dbtFiles,
  };
  let version = 0;

  const listeners = new Set<() => void>();
  /**
   * Merge a partial state into the snapshot, bump the version, and notify. A
   * `graph` whose reducer returned the same instance (a no-op) is skipped so
   * referential stability is preserved and no spurious re-render fires.
   */
  const commit = (partial: Partial<CatalogSnapshot>) => {
    if ("graph" in partial && partial.graph === snapshot.graph) {
      const { graph: _drop, ...rest } = partial;
      if (Object.keys(rest).length === 0) return;
    }
    snapshot = { ...snapshot, ...partial };
    version++;
    listeners.forEach((l) => l());
  };

  // REVALIDATE in the background: for each getter the primary implements, commit
  // its resolved value; on rejection keep the fallback value already seeded.
  // Lineage getters rebuild the graph (not exercised in slice 1).
  if (primary.getProjects) {
    primary
      .getProjects()
      .then((v) => commit({ projects: v }))
      .catch(() => {});
  }
  if (primary.getOrg) {
    primary
      .getOrg()
      .then((v) => commit({ org: v }))
      .catch(() => {});
  }
  if (primary.getRecents) {
    primary
      .getRecents()
      .then((v) => commit({ recents: v }))
      .catch(() => {});
  }
  if (primary.getAllChats) {
    primary
      .getAllChats()
      .then((v) => commit({ chats: v }))
      .catch(() => {});
  }
  if (primary.getChatScript) {
    primary
      .getChatScript()
      .then((v) => commit({ chatScript: v }))
      .catch(() => {});
  }
  if (primary.getDbtFiles) {
    primary
      .getDbtFiles()
      .then((v) => commit({ dbtFiles: v }))
      .catch(() => {});
  }
  // The currently-scoped project id, used by the captured-pid guard so a fast
  // A→B→A re-scope can't land a stale commit (a late B `.then` is dropped once
  // the scope has moved on). `undefined` during construction (no path yet).
  let currentScopedPid: string | undefined;

  /**
   * Re-run only the PROJECT-SCOPED primary getters (currentProject + the lineage
   * triple) and commit their results, building a FRESH {@link LineageGraph}. The
   * org-global getters (getProjects/getOrg/getRecents/getChatScript/getDbtFiles)
   * are NOT re-run — they don't change with the scope. Each `.then` is guarded
   * by a captured-pid check so a superseded switch's late resolution is dropped.
   *
   * Note: because this builds a fresh graph, per-project working mutations
   * (rename/archive/live-add) and cold storage reset on switch — correct, since
   * they're per-project.
   */
  const revalidateScoped = async (requestedPid: string): Promise<void> => {
    const stillCurrent = () => requestedPid === currentScopedPid;
    const tasks: Promise<void>[] = [];
    if (primary.getCurrentProject) {
      tasks.push(
        primary
          .getCurrentProject()
          .then((currentProject) => {
            if (!stillCurrent()) return;
            commit({ currentProject });
          })
          .catch(() => {}),
      );
    }
    if (primary.getNodes && primary.getEdges && primary.getAudit) {
      tasks.push(
        Promise.all([primary.getNodes(), primary.getEdges(), primary.getAudit()])
          .then(([n, e, a]) => {
            if (!stillCurrent()) return;
            commit({ graph: LineageGraph.from(n, e, a) });
          })
          .catch(() => {}),
      );
    }
    await Promise.all(tasks);
  };

  // Initial scoped revalidation at construction: pre-path, the primary resolves
  // the scope from its own default (the first project). getCurrentProject seeds
  // `currentScopedPid` so the guard has a baseline; if `selectProject` runs first
  // (the layout loader), it overrides the pid synchronously and these unguarded
  // construction commits still reflect the seed scope (the loader's guarded
  // re-scope supersedes them via the version bump).
  if (primary.getCurrentProject) {
    primary
      .getCurrentProject()
      .then((currentProject) => {
        currentScopedPid ??= currentProject.id;
        commit({ currentProject });
      })
      .catch(() => {});
  }
  if (primary.getNodes && primary.getEdges && primary.getAudit) {
    Promise.all([primary.getNodes(), primary.getEdges(), primary.getAudit()])
      .then(([n, e, a]) => commit({ graph: LineageGraph.from(n, e, a) }))
      .catch(() => {});
  }

  return {
    listProjects: () => snapshot.projects,
    getCurrentProject: () => snapshot.currentProject,
    getOrg: () => snapshot.org,
    listRecents: () => snapshot.recents,
    listChats: () => snapshot.chats,
    getChatScript: () => snapshot.chatScript,
    listDbtFiles: () => snapshot.dbtFiles,

    /* ─── lineage reads (delegated to the snapshot's graph) ──────────────── */
    /** A node by id from the visible graph, or undefined if absent/archived. */
    getNode: (id: string) => snapshot.graph.getNode(id),
    /** All active nodes. */
    listNodes: () => snapshot.graph.allNodes(),
    /** All active edges. */
    listEdges: () => snapshot.graph.allEdges(),
    /** Active nodes in a given pipeline layer. */
    getNodesByLayer: (layer: Layer) => snapshot.graph.nodesInLayer(layer),
    /** Non-source nodes that carry a model ref (datasets, views, reports). */
    listModels: () => snapshot.graph.models(),
    /** Upstream nodes feeding `id`, in edge order. */
    parentsOf: (id: string) => snapshot.graph.parentsOf(id),
    /** Downstream nodes that `id` feeds, in edge order. */
    childrenOf: (id: string) => snapshot.graph.childrenOf(id),
    /** Ids of non-source nodes with no incoming edge. */
    orphans: () => snapshot.graph.orphans(),
    /** True if a direct edge connects nodes `a` and `b` in either direction. */
    isNodeAdjacent: (a: string, b: string) =>
      snapshot.graph.isNodeAdjacent(a, b),
    /** True if `edge` is incident to `nodeId` (the node is one of its endpoints). */
    isEdgeAdjacent: (edge: Edge, nodeId: string) =>
      snapshot.graph.isEdgeAdjacent(edge, nodeId),
    /** The folded AI audit trail for a node; [] when none recorded. */
    auditFor: (id: string) => snapshot.graph.auditFor(id),
    /** Number of AI audit entries recorded against a node. */
    auditCount: (id: string) => snapshot.graph.auditCount(id),
    /** Nodes added live at runtime (e.g. a mart built by chat). */
    listAddedNodes: () => snapshot.graph.addedNodes(),
    /** Sources currently retired to cold storage, newest first. */
    listColdStorage: () => snapshot.graph.coldStorage(),

    /* ─── mutation commands (each commits a graph reducer + notifies) ────── */
    /** Rename a node by id; propagates to every projection that reads it. */
    renameSource: (id: string, name: string) =>
      commit({ graph: snapshot.graph.rename(id, name) }),
    /** Add a live source node (dedup by id). */
    addSource: (node: LineageNode) =>
      commit({ graph: snapshot.graph.addSource(node) }),
    /** Add a live model node and the edge feeding it (each deduped). */
    addModel: (node: LineageNode, edge: Edge) =>
      commit({ graph: snapshot.graph.addModel(node, edge) }),
    /** Archive a source: hide it from the graph and record it in cold storage. */
    archiveSource: (src: LineageNode) =>
      commit({ graph: snapshot.graph.archive(src.id, Date.now()) }),
    /** Restore an archived source: bring it back and drop it from cold storage. */
    restoreSource: (id: string) =>
      commit({ graph: snapshot.graph.restore(id) }),

    /* ─── project re-scope (project-in-path) ─────────────────────────────── */
    /**
     * Re-scope the catalog to a different project: set the scoped pid (the guard
     * baseline), then re-run only the project-scoped primary getters
     * (getCurrentProject + the lineage triple) and commit a FRESH graph +
     * currentProject. Org-global payloads are untouched. Because a fresh graph is
     * built, per-project working mutations and cold storage reset on switch
     * (correct — they're per-project). The injected catalog source must already
     * read the new scope (the app sets its scoped-pid holder before calling this;
     * see useCatalog.selectProject). Safe to call rapidly: a superseded switch's
     * late commit is dropped by the captured-pid guard.
     */
    selectProject: (projectId: string): Promise<void> => {
      currentScopedPid = projectId;
      return revalidateScoped(projectId);
    },

    /* ─── reactivity surface (for useSyncExternalStore) ──────────────────── */
    /** Register a listener; returns an unsubscribe function. */
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Opaque store version — bumps on every commit; a memo/dep token. */
    getSnapshot: (): number => version,
  };
}

export type DataCatalog = Awaited<ReturnType<typeof createDataCatalog>>;
