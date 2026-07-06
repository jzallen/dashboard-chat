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
import { createLogger } from "../lib/log";
import {
  createSourceUploadDriver,
  type ReportSink,
} from "../lib/source-upload-driver";
import type {
  CatalogSource,
  PartialCatalogSource,
  SourceUpload,
} from "./dataSources/source";
import type {
  AuditEntry,
  Edge,
  Layer,
  LineageNode,
} from "./lineage";
import { type ColdStorageRecord,LineageGraph } from "./lineageGraph";
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
const log = createLogger("catalog");

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

  // Org-global revalidation (projects/org/chatScript). NOT run at construction:
  // the authenticated app shell triggers it via refreshOrgGlobal() once a token
  // exists, so no unauthenticated fetch fires during the login round-trip (which
  // would 401, and leave the fixture projects driving a redirect to a project the
  // backend doesn't have). The project-scoped getters load separately via
  // selectProject (the project-layout loader). On rejection the seeded fallback
  // value is kept.
  const revalidateOrgGlobal = async (): Promise<void> => {
    // Drop the source's org-global memo FIRST so the reads below actually
    // re-fetch — a memoizing source would otherwise re-serve its first
    // (possibly pre-onboarding, empty) result forever. Optional: sources that
    // don't cache (the fixture) simply omit it.
    primary.invalidateOrgGlobal?.();
    const tasks: Promise<void>[] = [];
    if (primary.getProjects) {
      tasks.push(
        primary
          .getProjects()
          .then((v) => commit({ projects: v }))
          .catch((err) =>
            log.warn("read.projects.failed", { err: String(err) }),
          ),
      );
    }
    if (primary.getOrg) {
      tasks.push(
        primary
          .getOrg()
          .then((v) => commit({ org: v }))
          .catch((err) => log.warn("read.org.failed", { err: String(err) })),
      );
    }
    if (primary.getChatScript) {
      tasks.push(
        primary
          .getChatScript()
          .then((v) => commit({ chatScript: v }))
          .catch((err) =>
            log.warn("read.chatScript.failed", { err: String(err) }),
          ),
      );
    }
    await Promise.all(tasks);
  };
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
   * they're per-project. Cold storage is now derived from server truth by the
   * project-layout loader (via `toLineageGraph` coldRecords), so this revalidation
   * no longer needs to carry prior cold state forward.
   */
  const revalidateScoped = async (
    requestedPid: string,
    opts?: { fresh?: boolean },
  ): Promise<void> => {
    // A write-triggered revalidation must see fresh server state, so drop the
    // source's per-project cache first. A project SWITCH leaves it cached (SWR).
    if (opts?.fresh) primary.invalidateScope?.(requestedPid);
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
          .catch((err) =>
            log.warn("read.currentProject.failed", {
              pid: requestedPid,
              err: String(err),
            }),
          ),
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
          .catch((err) =>
            log.warn("read.recents.failed", {
              pid: requestedPid,
              err: String(err),
            }),
          ),
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
          .catch((err) =>
            log.warn("read.chats.failed", {
              pid: requestedPid,
              err: String(err),
            }),
          ),
      );
    }
    if (primary.getNodes && primary.getEdges && primary.getAudit) {
      tasks.push(
        Promise.all([
          primary.getNodes(),
          primary.getEdges(),
          primary.getAudit(),
        ])
          .then(([n, e, a]) => {
            if (!stillCurrent()) return;
            commit({ graph: LineageGraph.from(n, e, a) });
          })
          .catch((err) =>
            log.warn("read.lineage.failed", {
              pid: requestedPid,
              err: String(err),
            }),
          ),
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
          .catch((err) =>
            log.warn("read.dbtFiles.failed", {
              pid: requestedPid,
              err: String(err),
            }),
          ),
      );
    }
    await Promise.all(tasks);
  };

  // No project-scoped revalidation at construction: the project-layout loader
  // calls selectProject(params.projectId) for the route's project (and `/`
  // redirects to /project/:first), so the route is the only thing that loads a
  // project's currentProject/recents/chats/lineage. Until then the snapshot shows
  // the seeded fallback (fixtures).

  /**
   * Build the source-upload saga driver over the backend source ports + the
   * catalog's optimistic add/remove + a scope revalidation, bound to the
   * project scope captured at call time. Returns `null` when no backend source
   * backs the source-upload ports (the fixture fallback) so callers resolve
   * `undefined`. Shared by createSourceFromUpload (new source) and
   * addUploadToSource (existing source, slice 5).
   */
  const buildSourceUploadDriver = (report: ReportSink) => {
    if (
      !primary.createSource ||
      !primary.requestUpload ||
      !primary.putToStorage ||
      !primary.processUpload
    ) {
      return null;
    }
    const requestedPid = currentScopedPid;
    const driver = createSourceUploadDriver({
      catalog: {
        createSource: (sourceName) => primary.createSource!(sourceName),
        requestUpload: (sourceId, uploadFile) =>
          primary.requestUpload!(sourceId, uploadFile),
        putToStorage: (putUrl, uploadFile) =>
          primary.putToStorage!(putUrl, uploadFile),
        processUpload: (sourceId, uploadId, choices) =>
          primary.processUpload!(sourceId, uploadId, choices),
        revalidateScope: async () => {
          if (requestedPid !== undefined && requestedPid === currentScopedPid) {
            await revalidateScoped(requestedPid, { fresh: true });
          }
        },
      },
      report,
      addOptimistic: (node) =>
        commit({ graph: snapshot.graph.addSource(node) }),
      removeOptimistic: (id) =>
        commit({ graph: snapshot.graph.removeSource(id) }),
      log,
      newTempId: () =>
        `tmp.src.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}`,
    });
    return { driver, requestedPid };
  };

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
     * Rename a source node's display label — local-only. Source-layer nodes back
     * no backend entity, so the rename lives entirely in the working graph.
     * DECOUPLED from model/dataset renames, which land through the framework: the
     * model detail rename form submits a PATCH via `useFetcher` to the
     * `/ui-server/datasets/:id` action, and the loader re-derives on success.
     */
    renameSource: (id: string, name: string): void => {
      const node = snapshot.graph.getNode(id);
      if (!node || node.label === name) return; // missing or no-op
      commit({ graph: snapshot.graph.rename(id, name) });
    },
    /** Add a live source node (dedup by id). */
    addSource: (node: LineageNode) =>
      commit({ graph: snapshot.graph.addSource(node) }),
    /** Add a live model node and the edge feeding it (each deduped). */
    addModel: (node: LineageNode, edge: Edge) =>
      commit({ graph: snapshot.graph.addModel(node, edge) }),
    /**
     * Create a dataset from an uploaded file. Delegates to `primary.createDataset`
     * (the multipart upload that lands the file in the lake and creates the
     * dataset), then re-fetches the current project scope so the new dataset
     * appears in the lineage. Returns the new dataset id, or undefined when no
     * backend source backs uploads (the fixture fallback). Rejects on a failed
     * upload so the caller can surface it.
     */
    createDataset: async (file: File): Promise<string | undefined> => {
      if (!primary.createDataset) return undefined;
      log.info("write.createDataset", { name: file.name, size: file.size });
      try {
        const { id } = await primary.createDataset(file);
        log.info("write.createDataset.ok", { id });
        if (currentScopedPid !== undefined) {
          await revalidateScoped(currentScopedPid, { fresh: true });
        }
        return id;
      } catch (err) {
        log.error("write.createDataset.failed", {
          name: file.name,
          err: String(err),
        });
        throw err;
      }
    },

    /**
     * Create a Source from an uploaded file — the client-driven saga (slice 4).
     * Composes {@link createSourceUploadDriver} over the backend source ports +
     * the catalog's optimistic add/remove + a scope revalidation, and the
     * injected `report` sink (the StateProxy.postEvent the ui/ hook passes). The
     * driver: adds an optimistic source node, drives create→upload→process,
     * narrates each past-tense outcome to ui-state, then revalidates so the real
     * source + staging node + edge land. On failure it removes the optimistic
     * node, reports source_upload_failed, and re-throws.
     *
     * Returns the linked dataset id + temp node id, or `undefined` when no
     * backend source backs the source-upload ports (the fixture fallback).
     */
    createSourceFromUpload: async (
      file: File,
      name: string,
      report: ReportSink,
    ): Promise<{ datasetId: string; tempNodeId: string } | undefined> => {
      const built = buildSourceUploadDriver(report);
      if (!built) return undefined;
      return built.driver.createSourceFromUpload({
        file,
        name,
        projectId: built.requestedPid ?? "",
      });
    },

    /**
     * Add a file to an EXISTING source (slice 5). Skips createSource and adds
     * NO optimistic node — the source already exists on the canvas. Drives
     * requestUpload→putToStorage→process via the same driver, narrating
     * source_upload_started/processed. On a 4xx (e.g. 422 schema-mismatch) the
     * driver reports source_upload_failed and RE-THROWS the original error so
     * the surface can read the mismatch body. Returns the linked/appended
     * dataset id, or `undefined` when no backend source backs the ports.
     */
    addUploadToSource: async (
      sourceId: string,
      file: File,
      report: ReportSink,
    ): Promise<{ datasetId: string } | undefined> => {
      const built = buildSourceUploadDriver(report);
      if (!built) return undefined;
      return built.driver.addUploadToSource({
        file,
        sourceId,
        projectId: built.requestedPid ?? "",
      });
    },

    /**
     * List an existing source's uploaded files (backs the upload modal's Files
     * list). Delegates to the backend source's getSourceUploads; resolves `[]`
     * when no backend source backs the port (the fixture fallback), so the modal
     * simply shows an empty list rather than crashing.
     */
    getSourceUploads: async (sourceId: string): Promise<SourceUpload[]> => {
      if (!primary.getSourceUploads) return [];
      return primary.getSourceUploads(sourceId);
    },

    /**
     * Re-fetch the org-global payloads (projects/org/chatScript). Called by the
     * authenticated app shell on entry so real projects replace the fixture seed
     * before any redirect decision. Resolves once all settle (rejections keep the
     * fallback). Safe to call repeatedly.
     */
    refreshOrgGlobal: (): Promise<void> => revalidateOrgGlobal(),

    /**
     * Seed the org-global payloads (projects + org) from data already fetched
     * elsewhere. Where {@link refreshOrgGlobal} fetches client-side, this commits
     * values resolved server-side (the app-shell loader's), so real projects
     * replace the fixture seed without a second round-trip. One commit, one
     * version bump.
     */
    seedOrgGlobal: (projects: ProjectSummary[], org: OrgSettings): void => {
      commit({ projects, org });
    },

    /**
     * Seed the PROJECT-SCOPED payloads from data already fetched server-side (the
     * `/project/:projectId` loader's), replacing the prior scope's snapshot in one
     * commit. Where {@link selectProject} re-runs the project-scoped getters
     * client-side, this commits the SSR'd values straight through — no round-trip,
     * no browser read.
     *
     * Sets the scoped-pid guard baseline (so write-through revalidation targets
     * this project) and builds a FRESH {@link LineageGraph} from the loader's
     * nodes/edges/audit, so the previous project's lineage/sessions/dbt are dropped
     * rather than merged — switching scope never surfaces stale-scope data. The
     * org-global payloads (projects/org) are untouched; `currentProject` continues
     * to track the org-global project list.
     */
    seedProjectScoped: (data: {
      projectId: string;
      nodes: Record<string, LineageNode>;
      edges: Edge[];
      audit: Record<string, AuditEntry[]>;
      dbtFiles: DbtFile[];
      chats: ChatHistoryItem[];
      recents: ChatHistoryItem[];
      coldRecords?: ColdStorageRecord[];
    }): void => {
      currentScopedPid = data.projectId;
      commit({
        graph: LineageGraph.fromWithCold(
          data.nodes,
          data.edges,
          data.audit,
          data.coldRecords ?? [],
        ),
        chats: data.chats,
        recents: data.recents,
        dbtFiles: data.dbtFiles,
      });
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
      log.debug("scope.select", { pid: projectId });
      return revalidateScoped(projectId);
    },

    /**
     * Revalidate the CURRENTLY-scoped project against fresh server state — the
     * public seam for live reactive reads (e.g. the assistant-transform
     * reflection: an SSE `transform_applied` event from /ui-server/chat triggers this so
     * the lineage/preview re-derives). Wraps the private scoped revalidation with
     * `fresh:true` (drop the source's per-project cache first). No-op until a
     * project is scoped (the captured-pid guard also drops a late commit if the
     * scope changes mid-flight). Defaults `fresh:true`; pass `{ fresh:false }` for
     * an SWR-style refresh.
     */
    revalidateScope: (opts?: { fresh?: boolean }): Promise<void> => {
      if (currentScopedPid === undefined) return Promise.resolve();
      return revalidateScoped(currentScopedPid, { fresh: opts?.fresh ?? true });
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
