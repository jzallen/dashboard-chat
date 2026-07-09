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
import type { AuditEntry, Edge, Layer, LineageNode } from "./lineage";
import { type ColdStorageRecord, LineageGraph } from "./lineageGraph";
import type {
  ChatHistoryItem,
  ChatScript,
  CurrentProject,
  DbtFile,
  Model,
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

/**
 * The closed set of keys a commit may carry. The `satisfies` clause ties it to
 * {@link CatalogSnapshot}: adding a field to the snapshot without listing it here
 * (or listing a field the snapshot lacks) is a compile error, so the runtime
 * allowlist can never drift out of sync with the type.
 */
const SNAPSHOT_KEYS = {
  graph: true,
  projects: true,
  currentProject: true,
  org: true,
  recents: true,
  chats: true,
  chatScript: true,
  dbtFiles: true,
} satisfies Record<keyof CatalogSnapshot, true>;

/**
 * Fail fast on a commit carrying a key outside {@link SNAPSHOT_KEYS}. The store's
 * shallow merge is otherwise unvalidated: a misspelled or unknown key from a
 * dynamically-built seed or a loosely-typed feed would merge into the snapshot as
 * junk that TypeScript cannot catch at a cast call site. Throwing surfaces the bad
 * key at the offending call rather than letting corruption spread silently. Its own
 * driving port — a pure predicate over the partial's keys.
 */
export function assertKnownSnapshotKeys(partial: object): void {
  for (const key of Object.keys(partial)) {
    if (!(key in SNAPSHOT_KEYS)) {
      throw new Error(`catalog commit rejected unknown key: ${key}`);
    }
  }
}

/**
 * The immutable state the reactive store hands to a selector-based subscription
 * (`useCatalogWithSelector`). It is the {@link CatalogSnapshot} narrowed to a
 * read-only projection: every commit replaces the snapshot object wholesale, so
 * the reference is stable between mutations and changes on every mutation —
 * exactly the identity a `useSyncExternalStoreWithSelector` selector memoizes
 * against. The {@link LineageGraph} aggregate is exposed by reference (it is
 * itself immutable), keeping its encapsulation; a selector reads through its
 * query methods rather than any mutable internals.
 */
export type CatalogState = Readonly<CatalogSnapshot>;

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
   * referential stability is preserved and no spurious re-render fires. In
   * development every partial is first checked against {@link SNAPSHOT_KEYS} and an
   * unknown key throws; production skips the check.
   */
  const commit = (partial: Partial<CatalogSnapshot>) => {
    if (import.meta.env.DEV) assertKnownSnapshotKeys(partial);
    if ("graph" in partial && partial.graph === snapshot.graph) {
      const { graph: _drop, ...rest } = partial;
      if (Object.keys(rest).length === 0) return;
    }
    snapshot = { ...snapshot, ...partial };
    version++;
    listeners.forEach((l) => l());
  };

  // The current project scope, set by selectProject / seedProjectScoped. Used only
  // to tag the source-upload driver command's projectId (the report payload) and as
  // the seed baseline. `undefined` until the first scope is set.
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
    // TODO: no backend source implements getChatScript, so this branch is
    // currently dead and chatScript stays the fixture seed — the scripted
    // dependency-graph demo behind the chat-overlay pills. Backing it for real
    // needs the agent to iteratively build the graph in a loop, and may be
    // subsumed by the ghost-nodes work; deferred until then.
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
  // No client-side project-scoped revalidation: the project-layout loader
  // fetches the scoped reads server-side and the component seeds them via
  // seedProjectScoped, so the framework's loader IS the revalidation path. Until
  // the first seed the snapshot shows the seeded fallback (fixtures).

  /**
   * Build the source-upload saga driver over the backend source ports + the
   * catalog's optimistic add/remove + a framework revalidation. Returns `null`
   * when no backend source backs the source-upload ports (the fixture fallback)
   * so callers resolve `undefined`. The `revalidate` callback (the surface's
   * `useRevalidator().revalidate`) re-runs the loader once the saga lands the
   * real source. Shared by createSourceFromUpload (new source) and
   * addUploadToSource (existing source, slice 5).
   */
  const buildSourceUploadDriver = (
    report: ReportSink,
    revalidate: () => void | Promise<void>,
  ) => {
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
        revalidate: async () => {
          await revalidate();
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
    /**
     * The typed {@link Model} projection of a node by id, or undefined when the
     * node is absent/archived, carries no model ref, or bears an unrecognised
     * `kind`. Presentation reads a discriminated `Model` here rather than
     * narrowing a loose node itself.
     */
    getModel: (id: string): Model | undefined => snapshot.graph.getModel(id),
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
      revalidate: () => void | Promise<void>,
    ): Promise<{ datasetId: string; tempNodeId: string } | undefined> => {
      const built = buildSourceUploadDriver(report, revalidate);
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
      revalidate: () => void | Promise<void>,
    ): Promise<{ datasetId: string } | undefined> => {
      const built = buildSourceUploadDriver(report, revalidate);
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
     * Sets the scoped-pid guard baseline and builds a FRESH {@link LineageGraph}
     * from the loader's nodes/edges/audit (plus any archived datasets as cold
     * records), so the previous project's lineage/sessions/dbt are dropped rather
     * than merged — switching scope never surfaces stale-scope data.
     *
     * `currentProject` is DERIVED from the already-seeded org-global project list
     * (looked up by `projectId`) rather than fetched — the browser no longer reads
     * the backend for it. When the scoped project is not yet in the list (a race
     * before the org-global seed), a minimal record is used. The org-global
     * payloads (projects/org) are untouched.
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
      const proj = snapshot.projects.find((p) => p.id === data.projectId);
      const currentProject: CurrentProject = proj
        ? { id: proj.id, name: proj.name, description: proj.desc }
        : { id: data.projectId, name: data.projectId, description: "" };
      commit({
        currentProject,
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
     * Record the current project scope. The project-layout loader fetches the
     * scoped reads server-side and the component commits them via
     * {@link seedProjectScoped}, so re-derivation is the framework loader's job —
     * this only tracks which project the source-upload driver command targets.
     */
    selectProject: (projectId: string): Promise<void> => {
      currentScopedPid = projectId;
      log.debug("scope.select", { pid: projectId });
      return Promise.resolve();
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
    /**
     * The immutable store state for a selector-based subscription. Every commit
     * replaces the snapshot object, so this reference is stable between
     * mutations and fresh on each — the store-state a
     * `useSyncExternalStoreWithSelector` selector projects a slice off. Kept
     * alongside {@link getSnapshot} (the opaque version) for back-compat.
     */
    getStateSnapshot: (): CatalogState => snapshot,
  };
}

export type DataCatalog = Awaited<ReturnType<typeof createDataCatalog>>;
