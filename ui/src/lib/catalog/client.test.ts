import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDataCatalog } from "./client";
import type {
  CatalogSource,
  PartialCatalogSource,
} from "./dataSources/source";
import type { Edge, LineageNode } from "./lineage";
import type { ProjectSummary } from "./models";

/**
 * A tiny in-memory complete CatalogSource (the FALLBACK): one source node, one
 * mart-with-ref, one edge between them, and empty everything else. Getters are
 * async (`Promise.resolve`) per the CatalogSource port. Enough to exercise the
 * catalog's write side and delegated reads without dragging in fixtureData.js.
 */
function makeSource(): CatalogSource {
  const nodes: Record<string, LineageNode> = {
    "src.orders": {
      id: "src.orders",
      label: "orders",
      sub: "source",
      layer: "source",
      schema: [{ name: "id", type: "integer" }],
      files: [{ name: "orders.csv", rows: 10, when: "today" }],
    },
    "mart.revenue": {
      id: "mart.revenue",
      label: "revenue",
      sub: "mart",
      layer: "mart",
      ref: { columns_metadata: [] },
    },
  };
  const edges: Edge[] = [["src.orders", "mart.revenue"]];
  // Boundary payloads the catalog never inspects in these tests — empty/cast.
  const empty = [] as unknown;
  return {
    getProjects: () => Promise.resolve(empty as never),
    getCurrentProject: () => Promise.resolve({} as never),
    getOrg: () => Promise.resolve({} as never),
    getRecents: () => Promise.resolve(empty as never),
    getAllChats: () => Promise.resolve(empty as never),
    getNodes: () => Promise.resolve(nodes),
    getEdges: () => Promise.resolve(edges),
    getAudit: () => Promise.resolve({}),
    getChatScript: () => Promise.resolve({} as never),
    getDbtFiles: () => Promise.resolve(empty as never),
  };
}

/** A pause for queued microtasks so background revalidation `.then`s settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const FIXTURE_PROJECTS: ProjectSummary[] = [
  { id: "fixture", name: "Demo Project", desc: "", datasets: 0, models: 0 },
];

/** A complete fallback whose projects are a known fixture value. */
function fallbackWithProjects(): CatalogSource {
  const base = makeSource();
  return { ...base, getProjects: () => Promise.resolve(FIXTURE_PROJECTS) };
}

describe("createDataCatalog — write side", () => {
  let catalog: Awaited<ReturnType<typeof createDataCatalog>>;

  beforeEach(async () => {
    // No primary: the catalog is seeded purely from the fallback.
    catalog = await createDataCatalog({}, makeSource());
  });

  it("renameSource propagates to the catalog's node reads", () => {
    catalog.renameSource("src.orders", "raw_orders");
    expect(catalog.getNode("src.orders")?.label).toBe("raw_orders");
  });

  it("parentsOf reflects renames (over the working state, not raw source)", () => {
    catalog.renameSource("src.orders", "raw_orders");
    const parents = catalog.parentsOf("mart.revenue");
    expect(parents.map((p) => p.label)).toContain("raw_orders");
  });

  it("addModel adds the node + edge and lists it as a model", () => {
    const node: LineageNode = {
      id: "mart.churn",
      label: "churn",
      sub: "mart",
      layer: "mart",
      ref: { columns_metadata: [] },
    };
    const edge: Edge = ["mart.revenue", "mart.churn"];
    catalog.addModel(node, edge);

    expect(catalog.getNode("mart.churn")).toBeDefined();
    expect(catalog.listEdges()).toContainEqual(edge);
    expect(catalog.listModels().map((m) => m.id)).toContain("mart.churn");
  });

  it("addModel dedups repeated node + edge", () => {
    const node: LineageNode = {
      id: "mart.churn",
      label: "churn",
      sub: "mart",
      layer: "mart",
      ref: { columns_metadata: [] },
    };
    const edge: Edge = ["mart.revenue", "mart.churn"];
    catalog.addModel(node, edge);
    catalog.addModel(node, edge);

    expect(catalog.listAddedNodes()).toHaveLength(1);
    expect(
      catalog.listEdges().filter(([a, b]) => a === edge[0] && b === edge[1]),
    ).toHaveLength(1);
  });

  it("archiveSource removes the node + its edges from the graph and records cold storage", () => {
    const src = catalog.getNode("src.orders")!;
    catalog.archiveSource(src);

    expect(catalog.getNode("src.orders")).toBeUndefined();
    expect(
      catalog
        .listEdges()
        .some(([a, b]) => a === "src.orders" || b === "src.orders"),
    ).toBe(false);

    const cold = catalog.listColdStorage();
    expect(cold).toHaveLength(1);
    expect(cold[0].id).toBe("src.orders");
    expect(cold[0].name).toBe("orders");
    expect(cold[0].retentionDays).toBe(90);
  });

  it("restoreSource reverses archive (graph + cold storage)", () => {
    const src = catalog.getNode("src.orders")!;
    catalog.archiveSource(src);
    catalog.restoreSource("src.orders");

    expect(catalog.getNode("src.orders")).toBeDefined();
    expect(catalog.listEdges()).toContainEqual(["src.orders", "mart.revenue"]);
    expect(catalog.listColdStorage()).toHaveLength(0);
  });

  it("getNode is scoped to the visible graph — archived nodes resolve to undefined", () => {
    const src = catalog.getNode("src.orders")!;
    catalog.archiveSource(src);
    expect(catalog.getNode("src.orders")).toBeUndefined();
  });

  it("getSnapshot returns a stable version that bumps only on mutation", () => {
    const before = catalog.getSnapshot();
    expect(catalog.getSnapshot()).toBe(before);

    catalog.renameSource("src.orders", "raw_orders");
    const after = catalog.getSnapshot();
    expect(after).not.toBe(before);
    expect(catalog.getSnapshot()).toBe(after);
  });

  it("subscribe fires on each mutation; getSnapshot bumps; unsubscribe stops calls", () => {
    const fn = vi.fn();
    const v0 = catalog.getSnapshot();
    const unsubscribe = catalog.subscribe(fn);

    catalog.renameSource("src.orders", "a");
    expect(fn).toHaveBeenCalledTimes(1);
    const v1 = catalog.getSnapshot();
    expect(v1).not.toBe(v0);

    catalog.renameSource("src.orders", "b");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(catalog.getSnapshot()).not.toBe(v1);

    unsubscribe();
    catalog.renameSource("src.orders", "c");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("createDataCatalog — stale-while-revalidate (primary over fallback)", () => {
  const BACKEND_PROJECTS: ProjectSummary[] = [
    { id: "acme", name: "Acme Warehouse", desc: "real", datasets: 2, models: 0 },
  ];

  it("seeds from the fallback immediately, then a present primary getter overrides it", async () => {
    // A real backend getter settles on a macrotask (like fetch), so the seeded
    // fallback state is observable before revalidation lands.
    const primary: PartialCatalogSource = {
      getProjects: () =>
        new Promise((resolve) => setTimeout(() => resolve(BACKEND_PROJECTS), 0)),
    };
    const catalog = await createDataCatalog(primary, fallbackWithProjects());

    // Mounts instantly on the fallback…
    expect(catalog.listProjects()).toEqual(FIXTURE_PROJECTS);
    // …then the primary's resolved value lands as a reactive update.
    const fired = vi.fn();
    catalog.subscribe(fired);
    await flush();
    expect(catalog.listProjects()).toEqual(BACKEND_PROJECTS);
    expect(fired).toHaveBeenCalled();
  });

  it("a primary that does not implement a getter keeps the fallback value", async () => {
    const catalog = await createDataCatalog({}, fallbackWithProjects());
    await flush();
    expect(catalog.listProjects()).toEqual(FIXTURE_PROJECTS);
  });

  it("a primary getter that rejects keeps the fallback value (no flash, no crash)", async () => {
    const primary: PartialCatalogSource = {
      getProjects: () => Promise.reject(new Error("backend down")),
    };
    const catalog = await createDataCatalog(primary, fallbackWithProjects());
    await flush();
    expect(catalog.listProjects()).toEqual(FIXTURE_PROJECTS);
  });
});

describe("createDataCatalog — stale-while-revalidate (lineage graph)", () => {
  /** A primary backing all three lineage getters with a dataset→view graph. */
  function lineagePrimary(): PartialCatalogSource {
    const nodes: Record<string, LineageNode> = {
      "ds.1": {
        id: "ds.1",
        label: "customers",
        sub: "staging",
        layer: "staging",
        ref: { kind: "dataset", fields: [] },
      },
      "view.1": {
        id: "view.1",
        label: "active",
        sub: "intermediate",
        layer: "intermediate",
        ref: { kind: "view", columns: [] },
      },
    };
    const edges: Edge[] = [["ds.1", "view.1"]];
    return {
      getNodes: () =>
        new Promise((resolve) => setTimeout(() => resolve(nodes), 0)),
      getEdges: () =>
        new Promise((resolve) => setTimeout(() => resolve(edges), 0)),
      getAudit: () => new Promise((resolve) => setTimeout(() => resolve({}), 0)),
    };
  }

  it("a primary backing all three lineage getters replaces the fixture graph after flush", async () => {
    const catalog = await createDataCatalog(lineagePrimary(), makeSource());

    // Mounts on the fallback graph (src.orders + mart.revenue)…
    expect(catalog.listNodes().map((n) => n.id).sort()).toEqual([
      "mart.revenue",
      "src.orders",
    ]);

    const fired = vi.fn();
    catalog.subscribe(fired);
    await flush();

    // …then the backend graph lands and REPLACES the fixtures.
    expect(catalog.listNodes().map((n) => n.id).sort()).toEqual([
      "ds.1",
      "view.1",
    ]);
    expect(catalog.listModels().map((m) => m.id).sort()).toEqual([
      "ds.1",
      "view.1",
    ]);
    expect(catalog.listEdges()).toContainEqual(["ds.1", "view.1"]);
    expect(fired).toHaveBeenCalled();
  });

  it("a primary resolving an EMPTY lineage graph BLANKS the canvas (not fixtures)", async () => {
    const primary: PartialCatalogSource = {
      getNodes: () => new Promise((resolve) => setTimeout(() => resolve({}), 0)),
      getEdges: () => new Promise((resolve) => setTimeout(() => resolve([]), 0)),
      getAudit: () => new Promise((resolve) => setTimeout(() => resolve({}), 0)),
    };
    const catalog = await createDataCatalog(primary, makeSource());
    await flush();
    expect(catalog.listNodes()).toEqual([]);
    expect(catalog.listEdges()).toEqual([]);
  });

  it("a getNodes-rejecting primary keeps the fixture graph (error path, no crash)", async () => {
    const primary: PartialCatalogSource = {
      getNodes: () => Promise.reject(new Error("backend down")),
      getEdges: () => Promise.resolve([]),
      getAudit: () => Promise.resolve({}),
    };
    const catalog = await createDataCatalog(primary, makeSource());
    await flush();
    expect(catalog.listNodes().map((n) => n.id).sort()).toEqual([
      "mart.revenue",
      "src.orders",
    ]);
  });
});
