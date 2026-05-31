// Unit scenarios for the pure breadcrumb route-context resolver (MR-3).
//
// Authored RED by DISTILL (path-forward.md §4.1). The resolver is framework-free —
// it maps route params to the breadcrumb display context with no React/DOM. A
// model-detail route (dataset / view / report) yields a "model" context carrying
// the model kind + id; every other route is a "list" context.
import { describe, expect, it } from "vitest";

import { resolveBreadcrumbContext } from "./breadcrumbContext";

describe("resolveBreadcrumbContext — route → breadcrumb context", () => {
  it("returns a list context for a project pipeline/list route", () => {
    expect(resolveBreadcrumbContext({ projectId: "p1" })).toEqual({
      kind: "list",
    });
  });

  it("returns a list context when no model or project param is present", () => {
    expect(resolveBreadcrumbContext({})).toEqual({ kind: "list" });
  });

  it("returns a view model context on a view-detail route", () => {
    expect(resolveBreadcrumbContext({ viewId: "v1" })).toEqual({
      kind: "model",
      modelKind: "view",
      modelId: "v1",
    });
  });

  it("returns a report model context on a report-detail route", () => {
    expect(resolveBreadcrumbContext({ reportId: "r1" })).toEqual({
      kind: "model",
      modelKind: "report",
      modelId: "r1",
    });
  });

  it("returns a dataset model context on a dataset/table-detail route", () => {
    expect(resolveBreadcrumbContext({ datasetId: "d1" })).toEqual({
      kind: "model",
      modelKind: "dataset",
      modelId: "d1",
    });
  });

  it("treats a dataset-within-project route (both params) as a model context", () => {
    expect(
      resolveBreadcrumbContext({ projectId: "p1", datasetId: "d1" }),
    ).toEqual({ kind: "model", modelKind: "dataset", modelId: "d1" });
  });
});
