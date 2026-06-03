import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDataCatalog } from "./client";
import type { Edge, LineageNode } from "./lineage";
import type { CatalogSource } from "./source";

/**
 * A tiny in-memory CatalogSource: one source node, one mart-with-ref, one edge
 * between them, and empty everything else. Enough to exercise the write side and
 * its projections without dragging in the data.js fixture.
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
    getProjects: () => empty as never,
    getCurrentProject: () => ({}) as never,
    getOrg: () => ({}) as never,
    getRecents: () => empty as never,
    getAllChats: () => empty as never,
    getNodes: () => nodes,
    getEdges: () => edges,
    getAudit: () => ({}),
    getChatScript: () => ({}) as never,
    getDbtFiles: () => empty as never,
  };
}

describe("createDataCatalog — write side", () => {
  let catalog: ReturnType<typeof createDataCatalog>;

  beforeEach(() => {
    catalog = createDataCatalog(makeSource());
  });

  it("renameSource propagates to getNode and lineageGraph", () => {
    catalog.renameSource("src.orders", "raw_orders");
    expect(catalog.getNode("src.orders")?.label).toBe("raw_orders");
    expect(catalog.lineageGraph().nodes["src.orders"].label).toBe("raw_orders");
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

    const graph = catalog.lineageGraph();
    expect(graph.nodes["mart.churn"]).toBeDefined();
    expect(graph.edges).toContainEqual(edge);
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
      catalog.lineageGraph().edges.filter(([a, b]) => a === edge[0] && b === edge[1]),
    ).toHaveLength(1);
  });

  it("archiveSource removes the node + its edges and records cold storage", () => {
    const src = catalog.getNode("src.orders")!;
    catalog.archiveSource(src);

    const graph = catalog.lineageGraph();
    expect(graph.nodes["src.orders"]).toBeUndefined();
    expect(graph.edges.some(([a, b]) => a === "src.orders" || b === "src.orders")).toBe(false);

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

    const graph = catalog.lineageGraph();
    expect(graph.nodes["src.orders"]).toBeDefined();
    expect(graph.edges).toContainEqual(["src.orders", "mart.revenue"]);
    expect(catalog.listColdStorage()).toHaveLength(0);
  });

  it("subscribe is called on each mutation; getSnapshot increases; unsubscribe stops calls", () => {
    const fn = vi.fn();
    const v0 = catalog.getSnapshot();
    const unsubscribe = catalog.subscribe(fn);

    catalog.renameSource("src.orders", "a");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(catalog.getSnapshot()).toBeGreaterThan(v0);

    const v1 = catalog.getSnapshot();
    catalog.renameSource("src.orders", "b");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(catalog.getSnapshot()).toBeGreaterThan(v1);

    unsubscribe();
    catalog.renameSource("src.orders", "c");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
