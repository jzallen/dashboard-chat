// Acceptance scenarios for the three presentational lineage views + the in-canvas
// style switch (MR-2). Authored RED by DISTILL (path-forward.md §2.1).
//
// happy-dom does NOT apply stylesheets (wave-decisions DWD-M2-3), so these assert
// STRUCTURE: testids, layer grouping, edge presence, the orphan treatment per view
// (FlowView disables, LanesView badges), and the style-switch behaviour — NOT
// computed colors. Views consume a literal LineageGraph so they are tested in
// isolation from buildGraph.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { LineageGraph } from "../../../core/lineage/buildGraph";
import { AuditView } from "./AuditView";
import { FlowView } from "./FlowView";
import { LanesView } from "./LanesView";
import { PipelineCanvas } from "./PipelineCanvas";

afterEach(cleanup);

// A small graph: orders(staging) → int_revenue(intermediate) → fct_sales(mart),
// plus int_orphan(intermediate) with no live inputs (orphan).
const GRAPH: LineageGraph = {
  nodes: [
    { id: "d1", name: "orders", layer: "staging", kind: "dataset", orphan: false, archived: false },
    { id: "v1", name: "int_revenue", layer: "intermediate", kind: "view", orphan: false, archived: false },
    { id: "v2", name: "int_orphan", layer: "intermediate", kind: "view", orphan: true, archived: false },
    { id: "r1", name: "fct_sales", layer: "mart", kind: "report", orphan: false, archived: false },
  ],
  edges: [
    { from: "d1", to: "v1" },
    { from: "v1", to: "r1" },
  ],
};

// ─────────────────────────────── FlowView ───────────────────────────────

describe("FlowView — left→right DAG", () => {
  it("renders one node element per graph node", () => {
    render(<FlowView graph={GRAPH} />);
    expect(screen.getByTestId("flow-view")).toBeInTheDocument();
    for (const id of ["d1", "v1", "v2", "r1"]) {
      expect(screen.getByTestId(`flow-node-${id}`)).toBeInTheDocument();
    }
  });

  it("groups nodes into layer columns ordered staging → intermediate → mart (left→right)", () => {
    const { container } = render(<FlowView graph={GRAPH} />);
    const layerColumns = Array.from(
      container.querySelectorAll('[data-testid^="flow-layer-"]'),
    ).map((el) => el.getAttribute("data-testid"));
    expect(layerColumns).toEqual([
      "flow-layer-staging",
      "flow-layer-intermediate",
      "flow-layer-mart",
    ]);
  });

  it("renders an edge element for each graph edge", () => {
    render(<FlowView graph={GRAPH} />);
    expect(screen.getByTestId("flow-edge-d1-v1")).toBeInTheDocument();
    expect(screen.getByTestId("flow-edge-v1-r1")).toBeInTheDocument();
  });

  it("renders orphan nodes disabled and live nodes enabled", () => {
    render(<FlowView graph={GRAPH} />);
    expect(screen.getByTestId("flow-node-v2")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("flow-node-v1")).not.toHaveAttribute("aria-disabled", "true");
  });
});

// ─────────────────────────────── LanesView ───────────────────────────────

describe("LanesView — layer swimlanes", () => {
  it("renders one swimlane per present layer", () => {
    render(<LanesView graph={GRAPH} />);
    expect(screen.getByTestId("lanes-view")).toBeInTheDocument();
    expect(screen.getByTestId("lane-staging")).toBeInTheDocument();
    expect(screen.getByTestId("lane-intermediate")).toBeInTheDocument();
    expect(screen.getByTestId("lane-mart")).toBeInTheDocument();
  });

  it("places each node inside its layer's lane", () => {
    render(<LanesView graph={GRAPH} />);
    expect(within(screen.getByTestId("lane-staging")).getByTestId("lanes-node-d1")).toBeInTheDocument();
    expect(within(screen.getByTestId("lane-intermediate")).getByTestId("lanes-node-v1")).toBeInTheDocument();
    expect(within(screen.getByTestId("lane-mart")).getByTestId("lanes-node-r1")).toBeInTheDocument();
  });

  it("carries an \"Orphaned\" badge on orphan nodes only", () => {
    render(<LanesView graph={GRAPH} />);
    expect(within(screen.getByTestId("lanes-node-v2")).getByText("Orphaned")).toBeInTheDocument();
    expect(within(screen.getByTestId("lanes-node-v1")).queryByText("Orphaned")).toBeNull();
  });
});

// ─────────────────────────────── AuditView ───────────────────────────────

describe("AuditView — lineage stream with per-model audit", () => {
  it("renders one stream row per node with a per-model audit section", () => {
    render(<AuditView graph={GRAPH} />);
    expect(screen.getByTestId("audit-view")).toBeInTheDocument();
    for (const id of ["d1", "v1", "v2", "r1"]) {
      expect(screen.getByTestId(`audit-row-${id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`audit-detail-${id}`)).toBeInTheDocument();
    }
  });

  it("flags orphan nodes in the stream", () => {
    render(<AuditView graph={GRAPH} />);
    expect(within(screen.getByTestId("audit-row-v2")).getByText("Orphaned")).toBeInTheDocument();
  });
});

// ─────────────────────── PipelineCanvas — in-canvas style switch ───────────────────────

describe("PipelineCanvas — in-canvas style switch", () => {
  it("defaults to the Flow style", () => {
    render(<PipelineCanvas graph={GRAPH} />);
    expect(screen.getByTestId("flow-view")).toBeInTheDocument();
    expect(screen.queryByTestId("lanes-view")).toBeNull();
    expect(screen.queryByTestId("audit-view")).toBeNull();
  });

  it("exposes a switch control for each of the three styles", () => {
    render(<PipelineCanvas graph={GRAPH} />);
    expect(screen.getByTestId("pipeline-style-flow")).toBeInTheDocument();
    expect(screen.getByTestId("pipeline-style-lanes")).toBeInTheDocument();
    expect(screen.getByTestId("pipeline-style-audit")).toBeInTheDocument();
  });

  it("switches to Lanes then Audit when the controls are clicked", () => {
    render(<PipelineCanvas graph={GRAPH} />);

    fireEvent.click(screen.getByTestId("pipeline-style-lanes"));
    expect(screen.getByTestId("lanes-view")).toBeInTheDocument();
    expect(screen.queryByTestId("flow-view")).toBeNull();

    fireEvent.click(screen.getByTestId("pipeline-style-audit"));
    expect(screen.getByTestId("audit-view")).toBeInTheDocument();
    expect(screen.queryByTestId("lanes-view")).toBeNull();
  });

  it("honours an initialStyle override", () => {
    render(<PipelineCanvas graph={GRAPH} initialStyle="lanes" />);
    expect(screen.getByTestId("lanes-view")).toBeInTheDocument();
    expect(screen.queryByTestId("flow-view")).toBeNull();
  });
});
