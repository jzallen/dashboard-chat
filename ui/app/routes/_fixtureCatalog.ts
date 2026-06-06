/* A tiny in-memory CatalogSource for route/nav tests — one dataset (d1), one
   view (v1), one report (r1), and two projects, with model refs complete enough
   for <ModelDetail> to render. Modelled on app/catalog/client.test.ts's
   makeSource; node refs carry the full discriminated Model shape ModelDetail
   casts to. */
import type {
  CatalogSource,
  Edge,
  LineageNode,
  PartialCatalogSource,
  ProjectSummary,
} from "../catalog";

export const FIXTURE_PROJECTS: ProjectSummary[] = [
  { id: "proj-1", name: "Primary Project", desc: "", datasets: 1, models: 2 },
  { id: "proj-2", name: "Second Project", desc: "", datasets: 0, models: 0 },
];

/** d1 / v1 / r1, each with a complete Model ref keyed by `kind`. */
export function fixtureNodes(): Record<string, LineageNode> {
  return {
    d1: {
      id: "d1",
      label: "stg_customers",
      sub: "staging dataset",
      layer: "staging",
      ref: {
        kind: "dataset",
        name: "Customers (staging)",
        model: "stg_customers",
        rows: 0,
        fields: [],
        preview: [],
        transforms: [],
        sql: "select 1",
      },
    },
    v1: {
      id: "v1",
      label: "int_active_customers",
      sub: "intermediate view",
      layer: "intermediate",
      ref: {
        kind: "view",
        name: "Active Customers",
        model: "int_active_customers",
        materialization: "view",
        rows: 0,
        source_refs: [],
        columns: [],
        joins: [],
        filters: [],
        grain: { time_column: "", dimensions: [] },
        preview: [],
        sql: "select 1",
      },
    },
    r1: {
      id: "r1",
      label: "fct_revenue",
      sub: "mart report",
      layer: "mart",
      ref: {
        kind: "report",
        name: "Revenue Fact",
        model: "fct_revenue",
        report_type: "fact",
        materialization: "table",
        domain: "finance",
        rows: 0,
        source_refs: [],
        preview: [],
        columns_metadata: [],
        sql: "select 1",
      },
    },
  };
}

const empty = [] as unknown;

/** A complete fallback CatalogSource seeded with the fixture graph + projects. */
export function fixtureFallback(
  nodes: Record<string, LineageNode> = fixtureNodes(),
  edges: Edge[] = [],
): CatalogSource {
  return {
    getProjects: () => Promise.resolve(FIXTURE_PROJECTS),
    getCurrentProject: () =>
      Promise.resolve({ id: "proj-1", name: "Primary Project", description: "" }),
    getOrg: () =>
      Promise.resolve({
        name: "Acme",
        slug: "acme",
        region: "us",
        plan: "free",
        seats: 1,
        usedSeats: 1,
        created: "today",
        members: [],
        defaults: { engine: "duckdb", materialization: "view", modelPrefix: "" },
      }),
    getRecents: () => Promise.resolve(empty as never),
    getAllChats: () => Promise.resolve(empty as never),
    getNodes: () => Promise.resolve(nodes),
    getEdges: () => Promise.resolve(edges),
    getAudit: () => Promise.resolve({}),
    getChatScript: () => Promise.resolve({} as never),
    getDbtFiles: () => Promise.resolve(empty as never),
  };
}

/** A no-op primary (no backend revalidation) for the deterministic happy paths. */
export const NO_PRIMARY: PartialCatalogSource = {};
