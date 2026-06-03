import { describe, expect, it } from "vitest";

import type { AuditEntry, Edge, LineageNode } from "./lineage";
import {
  build,
  type CatalogBase,
  type CatalogOverlay,
} from "./lineageGraph";

/**
 * A tiny base fixture: one source node feeding one mart-with-ref via one edge,
 * with an audit trail recorded against the mart. Enough to exercise every
 * topology query and the audit folding through the public `build` port.
 */
function makeBase(): CatalogBase {
  const nodes: Record<string, LineageNode> = {
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
  const edges: Edge[] = [["src.orders", "mart.revenue"]];
  const audit: Record<string, AuditEntry[]> = {
    "mart.revenue": [{ tool: "sql", say: "summed revenue", tag: "measure" }],
  };
  return { nodes, edges, audit };
}

function emptyOverlay(): CatalogOverlay {
  return {
    renames: new Map(),
    archivedIds: new Set(),
    addedNodes: [],
    addedEdges: [],
  };
}

describe("LineageGraph — topology + audit", () => {
  it("parentsOf / childrenOf resolve over the working state, applying renames", () => {
    const overlay = emptyOverlay();
    overlay.renames.set("src.orders", "raw_orders");
    const graph = build(makeBase(), overlay);

    expect(graph.parentsOf("mart.revenue").map((p) => p.label)).toEqual([
      "raw_orders",
    ]);
    expect(graph.childrenOf("src.orders").map((c) => c.id)).toEqual([
      "mart.revenue",
    ]);
  });

  it("parentsOf / childrenOf surface live-added edges (addModel)", () => {
    const overlay = emptyOverlay();
    const churn: LineageNode = {
      id: "mart.churn",
      label: "churn",
      sub: "mart",
      layer: "mart",
      ref: { columns_metadata: [] },
    };
    overlay.addedNodes.push(churn);
    overlay.addedEdges.push(["mart.revenue", "mart.churn"]);
    const graph = build(makeBase(), overlay);

    expect(graph.parentsOf("mart.churn").map((p) => p.id)).toEqual([
      "mart.revenue",
    ]);
    expect(graph.childrenOf("mart.revenue").map((c) => c.id)).toEqual([
      "mart.churn",
    ]);
  });

  it("models() returns non-source ref-bearing nodes and excludes archived", () => {
    const base = makeBase();
    const overlay = emptyOverlay();
    expect(build(base, overlay).models().map((m) => m.id)).toEqual([
      "mart.revenue",
    ]);

    overlay.archivedIds.add("mart.revenue");
    expect(build(base, overlay).models()).toEqual([]);
  });

  it("nodesInLayer buckets by layer", () => {
    const graph = build(makeBase(), emptyOverlay());
    expect(graph.nodesInLayer("source").map((n) => n.id)).toEqual([
      "src.orders",
    ]);
    expect(graph.nodesInLayer("mart").map((n) => n.id)).toEqual([
      "mart.revenue",
    ]);
    expect(graph.nodesInLayer("staging")).toEqual([]);
  });

  it("orphans: a connected mart is not an orphan; an added mart with no incoming edge is; sources never are", () => {
    const overlay = emptyOverlay();
    const orphanMart: LineageNode = {
      id: "mart.lonely",
      label: "lonely",
      sub: "mart",
      layer: "mart",
      ref: { columns_metadata: [] },
    };
    overlay.addedNodes.push(orphanMart);
    const orphans = build(makeBase(), overlay).orphans();

    expect(orphans.has("mart.lonely")).toBe(true);
    expect(orphans.has("mart.revenue")).toBe(false);
    expect(orphans.has("src.orders")).toBe(false);
  });

  it("isAdjacent is true for a real edge in either direction, false otherwise", () => {
    const graph = build(makeBase(), emptyOverlay());
    expect(graph.isAdjacent("src.orders", "mart.revenue")).toBe(true);
    expect(graph.isAdjacent("mart.revenue", "src.orders")).toBe(true);
    expect(graph.isAdjacent("src.orders", "mart.nope")).toBe(false);
  });

  it("auditFor / auditCount return the folded audit, and [] / 0 when none", () => {
    const graph = build(makeBase(), emptyOverlay());
    expect(graph.auditFor("mart.revenue")).toEqual([
      { tool: "sql", say: "summed revenue", tag: "measure" },
    ]);
    expect(graph.auditCount("mart.revenue")).toBe(1);

    expect(graph.auditFor("src.orders")).toEqual([]);
    expect(graph.auditCount("src.orders")).toBe(0);
  });
});
