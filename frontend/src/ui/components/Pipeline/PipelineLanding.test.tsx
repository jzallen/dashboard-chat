// Acceptance scenarios for the Pipeline landing surface (MR-2).
//
// Authored RED by DISTILL (path-forward.md §4.2). The Pipeline is the landing
// surface for a selected project, registered at `projects/:projectId/pipeline`.
// The landing reads the active project from the route params, pulls datasets /
// views / reports from the dataCatalog TanStack Query hooks (the data port — NOT
// ui-state), builds the lineage graph, and renders the canvas.
//
// The hooks are mocked at the port boundary (mirrors ViewDetailView.test). The
// route param is exercised through createRoutesStub so this proves the landing is
// wired to `/projects/:projectId/pipeline`, not merely that the component renders.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DatasetSparse, Report, View } from "@/dataCatalog";

import PipelineLanding from "./index";

// ─────────────────────── port-boundary doubles (data hooks) ───────────────────────

const datasetsForProject: Record<string, DatasetSparse[]> = {
  "p1": [
    {
      id: "d1",
      name: "orders",
      link: "/api/datasets/d1",
      description: null,
      schema_config: { fields: {} },
    },
  ],
};

const viewsForProject: Record<string, View[]> = {
  "p1": [
    {
      id: "v1",
      project_id: "p1",
      org_id: "org-1",
      name: "int_revenue",
      description: null,
      sql_definition: "SELECT 1",
      source_refs: [{ id: "d1", type: "dataset" }],
      columns: [],
      joins: [],
      filters: [],
      grain: null,
      materialization: "view",
      created_at: null,
      updated_at: null,
    },
  ],
};

const reportsForProject: Record<string, Report[]> = {
  "p1": [
    {
      id: "r1",
      project_id: "p1",
      org_id: "org-1",
      name: "fct_sales",
      description: null,
      sql_definition: "SELECT 1",
      report_type: "fact",
      source_refs: [{ id: "v1", type: "view" }],
      domain: "sales",
      columns_metadata: [],
      materialization: "table",
      created_at: null,
      updated_at: null,
    },
  ],
};

// `loading` / `empty` toggles let individual tests drive the data-state branches.
const state = { loading: false, empty: false };

vi.mock("../../hooks/useDatasetQuery", () => ({
  useDatasets: (projectId: string | undefined) => ({
    data: state.empty ? [] : (datasetsForProject[projectId ?? ""] ?? []),
    isLoading: state.loading,
  }),
  // MR-7: PipelineLanding now also reads the archived set (cold storage). No archived
  // sources in these MR-2 scenarios.
  useArchivedDatasets: () => ({ data: [], isLoading: false }),
}));

vi.mock("../../hooks/useViewQuery", () => ({
  useViewsQuery: (projectId: string | undefined) => ({
    data: state.empty ? [] : (viewsForProject[projectId ?? ""] ?? []),
    isLoading: state.loading,
  }),
}));

vi.mock("../../hooks/useReportQuery", () => ({
  useReportsQuery: (projectId: string | undefined) => ({
    data: state.empty ? [] : (reportsForProject[projectId ?? ""] ?? []),
    isLoading: state.loading,
  }),
}));

afterEach(() => {
  cleanup();
  state.loading = false;
  state.empty = false;
});

function renderLandingAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Stub = createRoutesStub([
    {
      path: "projects/:projectId/pipeline",
      Component: PipelineLanding,
    },
  ]);
  return render(
    <QueryClientProvider client={queryClient}>
      <Stub initialEntries={[path]} />
    </QueryClientProvider>,
  );
}

describe("PipelineLanding — project landing surface", () => {
  it("renders the pipeline canvas with a node per catalog item for the active project", async () => {
    renderLandingAt("/projects/p1/pipeline");

    expect(await screen.findByTestId("pipeline-canvas")).toBeInTheDocument();
    // Default Flow style renders a node per dataset / view / report.
    expect(screen.getByTestId("flow-node-d1")).toBeInTheDocument();
    expect(screen.getByTestId("flow-node-v1")).toBeInTheDocument();
    expect(screen.getByTestId("flow-node-r1")).toBeInTheDocument();
  });

  it("shows a loading state while catalog data is in flight", async () => {
    state.loading = true;
    renderLandingAt("/projects/p1/pipeline");
    expect(await screen.findByTestId("pipeline-loading")).toBeInTheDocument();
  });

  it("shows an empty state when the project has no models", async () => {
    state.empty = true;
    renderLandingAt("/projects/p1/pipeline");
    expect(await screen.findByTestId("pipeline-empty")).toBeInTheDocument();
  });
});
