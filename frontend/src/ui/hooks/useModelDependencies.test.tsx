import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Report } from "@/dataCatalog";
import type { View } from "@/dataCatalog";

// MR-5 — useModelDependencies wraps the existing list hooks + MR-2 buildGraph.
// Double the three list hooks at the boundary (no QueryClient needed).
const datasets = [
  { id: "ds-1", name: "Orders", link: "", description: null, schema_config: { fields: {} } },
];
const views: View[] = [
  {
    id: "view-1",
    project_id: "p1",
    org_id: "o1",
    name: "Order View",
    description: null,
    sql_definition: "select 1",
    source_refs: [{ id: "ds-1", type: "dataset" }],
    columns: [],
    joins: [],
    filters: [],
    grain: null,
    materialization: "view",
    created_at: null,
    updated_at: null,
  },
];
const reports: Report[] = [
  {
    id: "report-1",
    project_id: "p1",
    org_id: "o1",
    name: "Revenue",
    description: null,
    sql_definition: "select 2",
    report_type: "fact",
    source_refs: [{ id: "view-1", type: "view" }],
    domain: "Finance",
    columns_metadata: [],
    materialization: "view",
    created_at: null,
    updated_at: null,
  },
];

const loading = { datasets: false, views: false, reports: false };

vi.mock("./useDatasetQuery", () => ({
  useDatasets: () => ({ data: datasets, isLoading: loading.datasets }),
}));
vi.mock("./useViewQuery", () => ({
  useViewsQuery: () => ({ data: views, isLoading: loading.views }),
}));
vi.mock("./useReportQuery", () => ({
  useReportsQuery: () => ({ data: reports, isLoading: loading.reports }),
}));

import { useModelDependencies } from "./useModelDependencies";

describe("useModelDependencies", () => {
  it("derives upstream + downstream for a view from the project graph", () => {
    const { result } = renderHook(() => useModelDependencies("p1", "view-1"));
    expect(result.current.upstream.map((n) => n.id)).toEqual(["ds-1"]);
    expect(result.current.downstream.map((n) => n.id)).toEqual(["report-1"]);
    expect(result.current.isLoading).toBe(false);
  });

  it("reports isLoading while any underlying list query is loading", () => {
    loading.reports = true;
    const { result } = renderHook(() => useModelDependencies("p1", "view-1"));
    expect(result.current.isLoading).toBe(true);
    loading.reports = false;
  });
});
