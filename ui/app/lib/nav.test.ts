import { describe, expect, it } from "vitest";

import type { LineageNode } from "../catalog";
import { nodeToPath } from "./nav";

/** A non-source lineage node whose kind lives on node.ref.kind. */
function nodeWithKind(
  id: string,
  kind: "dataset" | "view" | "report",
): LineageNode {
  return {
    id,
    label: id,
    sub: kind,
    layer: kind === "dataset" ? "staging" : kind === "view" ? "intermediate" : "mart",
    ref: { kind },
  };
}

describe("nodeToPath", () => {
  it("maps a dataset node to /project/:pid/dataset/:id", () => {
    expect(nodeToPath(nodeWithKind("ds.1", "dataset"), "p1")).toBe(
      "/project/p1/dataset/ds.1",
    );
  });

  it("maps a view node to /project/:pid/view/:id", () => {
    expect(nodeToPath(nodeWithKind("view.1", "view"), "p1")).toBe(
      "/project/p1/view/view.1",
    );
  });

  it("maps a report node to /project/:pid/report/:id", () => {
    expect(nodeToPath(nodeWithKind("rep.1", "report"), "p1")).toBe(
      "/project/p1/report/rep.1",
    );
  });
});
