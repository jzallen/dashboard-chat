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
import type { Edge, Layer, LineageNode, ModelKind } from "./lineage";
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
/**
 * The model kind behind a node, from its layer (the domain 1:1: staging→dataset,
 * intermediate→view, mart→report). `undefined` for source nodes, which have no
 * backend entity and stay local-only on write.
 */
const modelKindForLayer = (layer: Layer): ModelKind | undefined =>
  ({ staging: "dataset", intermediate: "view", mart: "report" } as const)[
    layer as "staging" | "intermediate" | "mart"
  ];

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

  // The currently-scoped project id, set ONLY by selectProject (the project-layout
  // loader) and used by the captured-pid guard so a fast A→B→A re-scope can't land
  // a stale commit. `undefined` until the first selectProject.
  let currentScopedPid: string | undefined;

  // CONSTRUCTION revalidation — ORG-GLOBAL getters ONLY (projects/org/chatScript).
  // The PROJECT-SCOPED getters (currentProject/recents/chats/lineage/dbtFiles) are
  // NOT loaded here: the route is the single source of the current project, so they
  // load exclusively via selectProject (the project-layout loader). That keeps one
  // loader of project data — no seed-scope default racing a cold deep-link to a
  // different project. On rejection the seeded fallback value is kept.
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
  if (primary.getChatScript) {
    primary
      .getChatScript()
      .then((v) => commit({ chatScript: v }))
      .catch(() => {});
  }
  /**
   * Re-run only the PROJECT-SCOPED primary getters (currentProject, the lineage
   * triple, the sessions-backed recents/chats, and the dbt manifest) and commit
   * their results, building a FRESH {@link LineageGraph}. The org-global getters
   * (getProjects/getOrg/getChatScript) are NOT re-run — they don't change with the
   * scope. recents/chats ARE project-scoped (a project's sessions) and dbtFiles is
   * a per-project manifest, so they re-derive here. Each `.then` is guarded by a
   * captured-pid check so a superseded switch's late resolution is dropped.
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
    if (primary.getRecents) {
      tasks.push(
        primary
          .getRecents()
          .then((recents) => {
            if (!stillCurrent()) return;
            commit({ recents });
          })
          .catch(() => {}),
      );
    }
    if (primary.getAllChats) {
      tasks.push(
        primary
          .getAllChats()
          .then((chats) => {
            if (!stillCurrent()) return;
            commit({ chats });
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
    if (primary.getDbtFiles) {
      tasks.push(
        primary
          .getDbtFiles()
          .then((dbtFiles) => {
            if (!stillCurrent()) return;
            commit({ dbtFiles });
          })
          .catch(() => {}),
      );
    }
    await Promise.all(tasks);
  };

  // No project-scoped revalidation at construction: the project-layout loader
  // calls selectProject(params.projectId) for the route's project (and `/`
  // redirects to /project/:first), so the route is the only thing that loads a
  // project's currentProject/recents/chats/lineage. Until then the snapshot shows
  // the seeded fallback (fixtures).

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
    /**
     * Rename a node — optimistic write-through. Commit the renamed graph for
     * instant feedback, then PATCH via `primary.renameModel` (routed by the
     * node's kind, derived from its layer); on rejection, roll the label back.
     * Source-layer nodes have no backend entity, so they stay local-only.
     */
    renameSource: async (id: string, name: string): Promise<void> => {
      const node = snapshot.graph.getNode(id);
      if (!node || node.label === name) return; // missing or no-op
      const prior = node.label;
      commit({ graph: snapshot.graph.rename(id, name) });

      const kind = modelKindForLayer(node.layer);
      if (!primary.renameModel || kind === undefined) return; // local-only
      try {
        await primary.renameModel(id, kind, name);
      } catch {
        commit({ graph: snapshot.graph.rename(id, prior) });
      }
    },
    /** Add a live source node (dedup by id). */
    addSource: (node: LineageNode) =>
      commit({ graph: snapshot.graph.addSource(node) }),
    /** Add a live model node and the edge feeding it (each deduped). */
    addModel: (node: LineageNode, edge: Edge) =>
      commit({ graph: snapshot.graph.addModel(node, edge) }),
    /**
     * Archive a node — optimistic write-through. Hide it (→ Cold Storage) for
     * instant feedback, then POST the soft-delete via `primary.archiveModel`
     * (datasets only; other kinds no-op server-side); on rejection, restore it.
     * Source-layer nodes have no backend entity, so they stay local-only.
     */
    archiveSource: async (src: LineageNode): Promise<void> => {
      const archived = snapshot.graph.archive(src.id, Date.now());
      if (archived === snapshot.graph) return; // absent or already archived
      commit({ graph: archived });

      const kind = modelKindForLayer(src.layer);
      if (!primary.archiveModel || kind === undefined) return; // local-only
      try {
        await primary.archiveModel(src.id, kind);
      } catch {
        commit({ graph: snapshot.graph.restore(src.id) });
      }
    },
    /**
     * Restore an archived node — optimistic write-through. Bring it back from
     * Cold Storage, then POST the un-archive via `primary.restoreModel`; on
     * rejection, re-archive it.
     */
    restoreSource: async (id: string): Promise<void> => {
      const restored = snapshot.graph.restore(id);
      if (restored === snapshot.graph) return; // nothing archived under that id
      commit({ graph: restored });

      const node = snapshot.graph.getNode(id);
      const kind = node ? modelKindForLayer(node.layer) : undefined;
      if (!primary.restoreModel || kind === undefined) return; // local-only
      try {
        await primary.restoreModel(id, kind);
      } catch {
        commit({ graph: snapshot.graph.archive(id, Date.now()) });
      }
    },

    /* ─── write commands (optimistic write-through) ──────────────────────── */
    /**
     * Toggle a transform-type audit entry — the catalog's FIRST optimistic
     * write-through. The flow:
     *   1. capture the prior `enabled` (for rollback);
     *   2. OPTIMISTIC: commit the flipped graph for instant UI feedback;
     *   3. PATCH via `primary.toggleAuditEntry?` (the backend write port);
     *   4. on success, REVALIDATE the current project's audit + lineage so the
     *      recompiled staging SQL/preview and the server `enabled` reflect truth
     *      (reusing `revalidateScoped` under the captured-pid guard);
     *   5. on rejection, ROLL BACK by committing the prior `enabled` (never
     *      crashes — mirrors the SWR error contract).
     * A no-op flip (graph reducer returns the same instance) is dropped by the
     * commit guard, and no write is attempted.
     */
    toggleAudit: async (
      nodeId: string,
      auditEntryId: string,
      enabled: boolean,
    ): Promise<void> => {
      const prior = snapshot.graph
        .auditFor(nodeId)
        .find((entry) => entry.auditEntryId === auditEntryId)?.enabled;
      const optimistic = snapshot.graph.withAuditToggled(
        nodeId,
        auditEntryId,
        enabled,
      );
      if (optimistic === snapshot.graph) return; // no-op flip — nothing to write
      commit({ graph: optimistic });

      if (!primary.toggleAuditEntry) return;
      const requestedPid = currentScopedPid;
      try {
        await primary.toggleAuditEntry(auditEntryId, enabled);
        // Revalidate only if still on the project the toggle targeted.
        if (requestedPid !== undefined && requestedPid === currentScopedPid) {
          await revalidateScoped(requestedPid);
        }
      } catch {
        // Roll back the optimistic flip to the prior server value.
        commit({
          graph: snapshot.graph.withAuditToggled(
            nodeId,
            auditEntryId,
            prior ?? false,
          ),
        });
      }
    },

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
