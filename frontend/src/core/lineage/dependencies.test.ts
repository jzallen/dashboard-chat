import { describe, expect, it } from "vitest";

import type { LineageGraph } from "./buildGraph";
import { deriveModelDependencies } from "./dependencies";

// MR-5 — deriveModelDependencies: a model's immediate upstream/downstream nodes.
const graph: LineageGraph = {
  nodes: [
    { id: "ds-1", name: "Orders", layer: "staging", kind: "dataset", orphan: false, archived: false },
    { id: "ds-2", name: "Customers", layer: "staging", kind: "dataset", orphan: false, archived: false },
    { id: "view-1", name: "Order View", layer: "intermediate", kind: "view", orphan: false, archived: false },
    { id: "report-1", name: "Revenue", layer: "mart", kind: "report", orphan: false, archived: false },
  ],
  edges: [
    { from: "ds-1", to: "view-1" },
    { from: "ds-2", to: "report-1" },
    { from: "view-1", to: "report-1" },
  ],
};

describe("deriveModelDependencies", () => {
  it("returns upstream producers and downstream consumers for a middle node", () => {
    const deps = deriveModelDependencies("view-1", graph);
    expect(deps.upstream.map((n) => n.id)).toEqual(["ds-1"]);
    expect(deps.downstream.map((n) => n.id)).toEqual(["report-1"]);
  });

  it("a root dataset has no upstream and lists its consumers downstream", () => {
    const deps = deriveModelDependencies("ds-1", graph);
    expect(deps.upstream).toEqual([]);
    expect(deps.downstream.map((n) => n.id)).toEqual(["view-1"]);
  });

  it("a leaf report has upstream producers and no downstream", () => {
    const deps = deriveModelDependencies("report-1", graph);
    // upstream preserves graph.nodes order (ds-2 before view-1)
    expect(deps.upstream.map((n) => n.id)).toEqual(["ds-2", "view-1"]);
    expect(deps.downstream).toEqual([]);
  });

  it("resolves full node objects (name + kind), not bare ids", () => {
    const deps = deriveModelDependencies("view-1", graph);
    expect(deps.upstream[0]).toMatchObject({ id: "ds-1", name: "Orders", kind: "dataset" });
    expect(deps.downstream[0]).toMatchObject({ id: "report-1", name: "Revenue", kind: "report" });
  });

  it("returns empty arrays for an unknown model id", () => {
    const deps = deriveModelDependencies("nope", graph);
    expect(deps.upstream).toEqual([]);
    expect(deps.downstream).toEqual([]);
  });
});
