import { describe, expect, it } from "vitest";

import type { LineageNode } from "../../src/lib/catalog";
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
  it("maps a dataset node to /table/:id", () => {
    expect(nodeToPath(nodeWithKind("ds.1", "dataset"))).toBe("/table/ds.1");
  });

  it("maps a view node to /view/:id", () => {
    expect(nodeToPath(nodeWithKind("view.1", "view"))).toBe("/view/view.1");
  });

  it("maps a report node to /report/:id", () => {
    expect(nodeToPath(nodeWithKind("rep.1", "report"))).toBe("/report/rep.1");
  });

  it("appends ?project= when a project id is given", () => {
    expect(nodeToPath(nodeWithKind("view.1", "view"), "proj-7")).toBe(
      "/view/view.1?project=proj-7",
    );
  });
});
