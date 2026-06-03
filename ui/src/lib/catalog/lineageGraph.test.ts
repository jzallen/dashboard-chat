import { describe, expect, it } from "vitest";

import type { AuditEntry, Edge, LineageNode } from "./lineage";
import { LineageGraph } from "./lineageGraph";

/**
 * A tiny fixture: one source node feeding one mart-with-ref via one edge, with
 * an audit trail recorded against the mart. Enough to exercise every topology
 * query, the audit folding, and the archive/restore reducers.
 */
const NODES: Record<string, LineageNode> = {
  "src.orders": {
    id: "src.orders",
    label: "orders",
    sub: "source",
    layer: "source",
    schema: [{ name: "id", type: "integer" }],
  },
  "mart.revenue": {
    id: "mart.revenue",
    label: "revenue",
    sub: "mart",
    layer: "mart",
    ref: { columns_metadata: [] },
  },
};
const EDGES: Edge[] = [["src.orders", "mart.revenue"]];
const AUDIT: Record<string, AuditEntry[]> = {
  "mart.revenue": [{ tool: "sql", say: "summed revenue", tag: "measure" }],
};

const makeGraph = () =>
  LineageGraph.fromSource({
    getNodes: () => NODES,
    getEdges: () => EDGES,
    getAudit: () => AUDIT,
  });

const churn: LineageNode = {
  id: "mart.churn",
  label: "churn",
  sub: "mart",
  layer: "mart",
  ref: { columns_metadata: [] },
};

describe("LineageGraph — topology + audit", () => {
  it("parentsOf / childrenOf resolve over the working state, applying renames", () => {
    const graph = makeGraph().rename("src.orders", "raw_orders");
    expect(graph.parentsOf("mart.revenue").map((p) => p.label)).toEqual([
      "raw_orders",
    ]);
    expect(graph.childrenOf("src.orders").map((c) => c.id)).toEqual([
      "mart.revenue",
    ]);
  });

  it("addModel surfaces the live-added node + edge in both directions", () => {
    const graph = makeGraph().addModel(churn, ["mart.revenue", "mart.churn"]);
    expect(graph.parentsOf("mart.churn").map((p) => p.id)).toEqual([
      "mart.revenue",
    ]);
    expect(graph.childrenOf("mart.revenue").map((c) => c.id)).toEqual([
      "mart.churn",
    ]);
  });

  it("models() returns non-source ref-bearing nodes and excludes archived", () => {
    expect(makeGraph().models().map((m) => m.id)).toEqual(["mart.revenue"]);
    expect(makeGraph().archive("mart.revenue", 0).models()).toEqual([]);
  });

  it("nodesInLayer buckets by layer", () => {
    const graph = makeGraph();
    expect(graph.nodesInLayer("source").map((n) => n.id)).toEqual([
      "src.orders",
    ]);
    expect(graph.nodesInLayer("mart").map((n) => n.id)).toEqual([
      "mart.revenue",
    ]);
    expect(graph.nodesInLayer("staging")).toEqual([]);
  });

  it("orphans: a connected mart is not an orphan; an added mart with no incoming edge is; sources never are", () => {
    const orphanMart: LineageNode = { ...churn, id: "mart.lonely", label: "lonely" };
    const orphans = makeGraph().addSource(orphanMart).orphans();
    expect(orphans.has("mart.lonely")).toBe(true);
    expect(orphans.has("mart.revenue")).toBe(false);
    expect(orphans.has("src.orders")).toBe(false);
  });

  it("isAdjacent is true for a real edge in either direction, false otherwise", () => {
    const graph = makeGraph();
    expect(graph.isAdjacent("src.orders", "mart.revenue")).toBe(true);
    expect(graph.isAdjacent("mart.revenue", "src.orders")).toBe(true);
    expect(graph.isAdjacent("src.orders", "mart.nope")).toBe(false);
  });

  it("auditFor / auditCount return the folded audit, and [] / 0 when none", () => {
    const graph = makeGraph();
    expect(graph.auditFor("mart.revenue")).toEqual([
      { tool: "sql", say: "summed revenue", tag: "measure" },
    ]);
    expect(graph.auditCount("mart.revenue")).toBe(1);
    expect(graph.auditFor("src.orders")).toEqual([]);
    expect(graph.auditCount("src.orders")).toBe(0);
  });

  it("addedNodes tracks runtime adds (and drops them once archived)", () => {
    const graph = makeGraph().addModel(churn, ["mart.revenue", "mart.churn"]);
    expect(graph.addedNodes().map((n) => n.id)).toEqual(["mart.churn"]);
    expect(graph.archive("mart.churn", 0).addedNodes()).toEqual([]);
  });
});

describe("LineageGraph — archive / restore", () => {
  it("archive moves the node + its edges into cold storage; the active DAG drops them", () => {
    const graph = makeGraph().archive("src.orders", 1000);

    expect(graph.getNode("src.orders")).toBeUndefined();
    expect(graph.allEdges()).toEqual([]); // the only edge touched src.orders
    expect(graph.parentsOf("mart.revenue")).toEqual([]);

    const cold = graph.coldStorage();
    expect(cold.map((c) => c.id)).toEqual(["src.orders"]);
    expect(cold[0].name).toBe("orders");
    expect(cold[0].retiredAt).toBe(1000);
    expect(cold[0].retentionDays).toBe(90);
  });

  it("restore brings the node + stashed edges back and clears cold storage", () => {
    const restored = makeGraph().archive("src.orders", 1000).restore("src.orders");

    expect(restored.getNode("src.orders")?.label).toBe("orders");
    expect(restored.allEdges()).toContainEqual(["src.orders", "mart.revenue"]);
    expect(restored.parentsOf("mart.revenue").map((p) => p.id)).toEqual([
      "src.orders",
    ]);
    expect(restored.coldStorage()).toEqual([]);
  });

  it("coldStorage lists newest-first", () => {
    const graph = makeGraph()
      .addSource({ ...NODES["src.orders"], id: "src.events", label: "events" })
      .archive("src.orders", 1000)
      .archive("src.events", 2000);
    expect(graph.coldStorage().map((c) => c.id)).toEqual([
      "src.events",
      "src.orders",
    ]);
  });
});

describe("LineageGraph — immutability", () => {
  it("reducers return a new instance and never mutate the receiver", () => {
    const graph = makeGraph();
    const renamed = graph.rename("src.orders", "raw_orders");

    expect(renamed).not.toBe(graph);
    expect(renamed.getNode("src.orders")?.label).toBe("raw_orders");
    // original is untouched
    expect(graph.getNode("src.orders")?.label).toBe("orders");
  });

  it("a no-op reducer returns the same instance (referentially stable)", () => {
    const graph = makeGraph();
    expect(graph.rename("does.not.exist", "x")).toBe(graph);
    expect(graph.restore("not.archived")).toBe(graph);
    expect(graph.addSource(NODES["src.orders"])).toBe(graph); // already present
  });
});
