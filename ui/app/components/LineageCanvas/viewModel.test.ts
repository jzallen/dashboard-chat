import { describe, expect, it } from "vitest";

import { createDataCatalog, type DataCatalog } from "../../catalog";
import { fixtureFallback } from "../../routes/_fixtureCatalog";
import {
  auditTrailViewModel,
  dagFocusModel,
  laneCardViewModel,
} from "./viewModel";

async function catalog(edges: [string, string][] = []): Promise<DataCatalog> {
  return createDataCatalog({}, fixtureFallback(undefined, edges));
}

describe("laneCardViewModel", () => {
  it("carries parent labels and audit count for a model node", async () => {
    const cat = await catalog();
    const vm = laneCardViewModel(cat, "v1");
    expect(vm.parentLabels).toEqual(cat.parentsOf("v1").map((p) => p.label));
    expect(vm.auditCount).toBe(cat.auditCount("v1"));
  });
});

describe("auditTrailViewModel", () => {
  it("carries the folded audit trail for a node", async () => {
    const cat = await catalog();
    const vm = auditTrailViewModel(cat, "d1");
    expect(vm.audit).toEqual(cat.auditFor("d1"));
  });
});

describe("dagFocusModel", () => {
  it("marks the incident edge hot and dims non-adjacent nodes on focus", async () => {
    // d1 → v1 edge; focus d1: its edge (index 0) is hot, r1 (not adjacent) dims.
    const cat = await catalog([["d1", "v1"]]);
    const focus = dagFocusModel(cat, "d1");
    expect(focus.hotEdges.has(0)).toBe(true);
    expect(focus.isDimmed("v1")).toBe(false);
    expect(focus.isDimmed("d1")).toBe(false);
    expect(focus.isDimmed("r1")).toBe(true);
  });

  it("has no hot edges and dims nothing with no focus", async () => {
    const cat = await catalog([["d1", "v1"]]);
    const focus = dagFocusModel(cat, null);
    expect(focus.hotEdges.size).toBe(0);
    expect(focus.isDimmed("r1")).toBe(false);
  });
});
