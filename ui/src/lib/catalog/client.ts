/**
 * createDataCatalog — the catalog's query surface, built over a
 * {@link CatalogSource}. Components read the catalog through the object this
 * returns; the source supplies the raw payloads and this factory adds the
 * projections (lineage graph assembly, audit counts, model filtering).
 *
 * Pure: depends only on the lineage types and the source port — never on a
 * concrete data module. Swap the source to repoint the catalog at a backend.
 */
import type { Edge, Graph, LineageNode } from "./lineage";
import type { CatalogSource } from "./source";

/** Options for {@link DataCatalog.lineageGraph}: live additions + overrides. */
export interface LineageGraphOptions {
  extraNodes?: LineageNode[];
  extraEdges?: Edge[];
  archived?: string[];
  nameOverrides?: Record<string, string>;
}

export function createDataCatalog(source: CatalogSource) {
  /**
   * Assemble the working graph from the static catalog plus runtime mutations:
   * merge any `extraNodes` (e.g. a mart added live by chat), drop `archived`
   * nodes and every edge touching them, and apply `nameOverrides` (id → label).
   */
  function lineageGraph(opts: LineageGraphOptions = {}): Graph {
    const { extraNodes, extraEdges, archived, nameOverrides } = opts;
    const base: Record<string, LineageNode> = { ...source.getNodes() };
    (extraNodes || []).forEach((n) => {
      base[n.id] = n;
    });
    const archivedIds = new Set(archived || []);
    const nameOverrideMap = nameOverrides || {};
    const nodes: Record<string, LineageNode> = {};
    Object.values(base).forEach((n) => {
      if (archivedIds.has(n.id)) return;
      nodes[n.id] = nameOverrideMap[n.id]
        ? { ...n, label: nameOverrideMap[n.id] }
        : n;
    });
    const edges = [...source.getEdges(), ...(extraEdges || [])].filter(
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

    getNode: (id: string) => source.getNodes()[id],
    listNodes: () => Object.values(source.getNodes()),
    /** Non-source nodes that carry a model ref (datasets, views, reports). */
    listModels: () =>
      Object.values(source.getNodes()).filter(
        (n) => n.layer !== "source" && n.ref,
      ),
    /** Upstream nodes feeding `id`, in edge order. */
    parentsOf: (id: string): LineageNode[] => {
      const nodes = source.getNodes();
      return source
        .getEdges()
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
  };
}

export type DataCatalog = ReturnType<typeof createDataCatalog>;
