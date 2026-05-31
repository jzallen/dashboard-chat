// Acceptance + unit scenarios for the lineage graph builder (MR-2).
//
// RED suite authored by DISTILL (path-forward.md §2.1/§4.5). The builder is a pure
// core function derived from the dataCatalog REST data (datasets / views / reports),
// NOT from ui-state. Orphan detection is the builder's single source of truth.
//
// Contract under test:
//   - Layers: dataset → "staging", view → "intermediate", report → "mart".
//     ("source" layer is reserved for MR-6 upload sources — no nodes here.)
//   - Edges are LIVE upstream→downstream dependencies: emitted only when the
//     referenced upstream node is present AND not archived.
//   - Orphan = a non-dataset node with zero live incoming edges (all its
//     source_refs are absent-or-archived, or it has none). Datasets are roots and
//     are never orphans.
import { describe, expect, it } from "vitest";

import type { Report } from "@/dataCatalog";
import type { View } from "@/dataCatalog";

import { buildGraph, type LineageDatasetInput } from "./buildGraph";

// ─────────────────────────── fixtures ───────────────────────────

function ds(id: string, name = id): LineageDatasetInput {
  return { id, name };
}

function makeView(
  id: string,
  sourceRefs: Array<{ id: string; type: "dataset" | "view" }>,
  name = id,
): View {
  return {
    id,
    project_id: "proj-1",
    org_id: "org-1",
    name,
    description: null,
    sql_definition: "SELECT 1",
    source_refs: sourceRefs,
    columns: [],
    joins: [],
    filters: [],
    grain: null,
    materialization: "view",
    created_at: null,
    updated_at: null,
  };
}

function makeReport(
  id: string,
  sourceRefs: Array<{ id: string; type: "dataset" | "view" }>,
  name = id,
): Report {
  return {
    id,
    project_id: "proj-1",
    org_id: "org-1",
    name,
    description: null,
    sql_definition: "SELECT 1",
    report_type: "fact",
    source_refs: sourceRefs,
    domain: "sales",
    columns_metadata: [],
    materialization: "table",
    created_at: null,
    updated_at: null,
  };
}

const NONE: ReadonlySet<string> = new Set();

function nodeById(
  graph: ReturnType<typeof buildGraph>,
  id: string,
) {
  const node = graph.nodes.find((n) => n.id === id);
  if (!node) throw new Error(`node ${id} not in graph`);
  return node;
}

function hasEdge(
  graph: ReturnType<typeof buildGraph>,
  from: string,
  to: string,
): boolean {
  return graph.edges.some((e) => e.from === from && e.to === to);
}

// ─────────────────────── layer / kind mapping ───────────────────────

describe("buildGraph — layer + kind mapping", () => {
  it("maps datasets→staging, views→intermediate, reports→mart with a node per catalog item", () => {
    const graph = buildGraph(
      [ds("d1", "orders"), ds("d2", "customers")],
      [makeView("v1", [{ id: "d1", type: "dataset" }], "int_revenue")],
      [makeReport("r1", [{ id: "v1", type: "view" }], "fct_sales")],
      NONE,
    );

    expect(graph.nodes).toHaveLength(4);
    expect(nodeById(graph, "d1")).toMatchObject({ layer: "staging", kind: "dataset", name: "orders" });
    expect(nodeById(graph, "d2")).toMatchObject({ layer: "staging", kind: "dataset" });
    expect(nodeById(graph, "v1")).toMatchObject({ layer: "intermediate", kind: "view", name: "int_revenue" });
    expect(nodeById(graph, "r1")).toMatchObject({ layer: "mart", kind: "report", name: "fct_sales" });
  });

  it("produces no source-layer nodes in MR-2 (source layer reserved for upload sources)", () => {
    const graph = buildGraph([ds("d1")], [], [], NONE);
    expect(graph.nodes.some((n) => n.layer === "source")).toBe(false);
  });
});

// ─────────────────────────── edges ───────────────────────────

describe("buildGraph — edge derivation from source_refs", () => {
  it("derives an upstream→downstream edge from each view source_ref", () => {
    const graph = buildGraph(
      [ds("d1")],
      [makeView("v1", [{ id: "d1", type: "dataset" }])],
      [],
      NONE,
    );
    expect(hasEdge(graph, "d1", "v1")).toBe(true);
    expect(graph.edges).toHaveLength(1);
  });

  it("derives edges from report source_refs over both dataset and view upstreams", () => {
    const graph = buildGraph(
      [ds("d1")],
      [makeView("v1", [{ id: "d1", type: "dataset" }])],
      [makeReport("r1", [
        { id: "v1", type: "view" },
        { id: "d1", type: "dataset" },
      ])],
      NONE,
    );
    expect(hasEdge(graph, "v1", "r1")).toBe(true);
    expect(hasEdge(graph, "d1", "r1")).toBe(true);
  });

  it("emits distinct edges when one node feeds multiple downstreams", () => {
    const graph = buildGraph(
      [ds("d1")],
      [makeView("v1", [{ id: "d1", type: "dataset" }])],
      [makeReport("r1", [{ id: "d1", type: "dataset" }])],
      NONE,
    );
    expect(hasEdge(graph, "d1", "v1")).toBe(true);
    expect(hasEdge(graph, "d1", "r1")).toBe(true);
  });

  it("does NOT emit a duplicate edge when the same upstream is referenced twice", () => {
    const graph = buildGraph(
      [ds("d1")],
      [makeView("v1", [
        { id: "d1", type: "dataset" },
        { id: "d1", type: "dataset" },
      ])],
      [],
      NONE,
    );
    expect(graph.edges.filter((e) => e.from === "d1" && e.to === "v1")).toHaveLength(1);
  });

  it("does NOT emit a dangling edge to an absent upstream", () => {
    const graph = buildGraph(
      [],
      [makeView("v1", [{ id: "ghost", type: "dataset" }])],
      [],
      NONE,
    );
    expect(graph.edges).toHaveLength(0);
  });
});

// ─────────────────────── orphan detection ───────────────────────

describe("buildGraph — orphan detection", () => {
  it("never marks a dataset (root) as an orphan, even with no refs", () => {
    const graph = buildGraph([ds("d1")], [], [], NONE);
    expect(nodeById(graph, "d1").orphan).toBe(false);
  });

  it("keeps a view live when at least one input is present and unarchived", () => {
    const graph = buildGraph(
      [ds("d1")],
      [makeView("v1", [{ id: "d1", type: "dataset" }])],
      [],
      NONE,
    );
    expect(nodeById(graph, "v1").orphan).toBe(false);
  });

  it("marks a view orphan when every source_ref is absent", () => {
    const graph = buildGraph(
      [],
      [makeView("v1", [{ id: "ghost", type: "dataset" }])],
      [],
      NONE,
    );
    expect(nodeById(graph, "v1").orphan).toBe(true);
  });

  it("marks a non-dataset node orphan when it has no source_refs at all", () => {
    const graph = buildGraph([], [], [makeReport("r1", [])], NONE);
    expect(nodeById(graph, "r1").orphan).toBe(true);
  });

  it("marks a view orphan when its only input is archived, and flags the archived node", () => {
    const graph = buildGraph(
      [ds("d1")],
      [makeView("v1", [{ id: "d1", type: "dataset" }])],
      [],
      new Set(["d1"]),
    );
    expect(nodeById(graph, "d1").archived).toBe(true);
    expect(nodeById(graph, "v1").orphan).toBe(true);
    // An archived upstream is not a live dependency — no edge is drawn.
    expect(hasEdge(graph, "d1", "v1")).toBe(false);
  });

  it("marks a report orphan when all inputs are absent-or-archived", () => {
    const graph = buildGraph(
      [ds("d1")],
      [],
      [makeReport("r1", [
        { id: "d1", type: "dataset" },
        { id: "ghost", type: "view" },
      ])],
      new Set(["d1"]),
    );
    expect(nodeById(graph, "r1").orphan).toBe(true);
  });
});

// ─────────────────────────── edge cases ───────────────────────────

describe("buildGraph — empty inputs", () => {
  it("returns an empty graph (no nodes, no edges) without throwing", () => {
    const graph = buildGraph([], [], [], NONE);
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });
});
