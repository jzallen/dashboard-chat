// MR-6 — source-node reopen + Pipeline toolbar upload trigger.
//
// The standalone upload modal is toolbar-triggered on the Pipeline landing surface
// (detached from the assistant, DWD-M6-8) and reopens when a source (dataset) node is
// activated (additive optional onNodeActivate threaded through the canvas/views — no
// MR-2 regression, DWD-M6-9). The data hooks + dataCatalog clients are doubled at the
// boundary; the route param is exercised through createRoutesStub (mirrors PipelineLanding.test).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DatasetSparse, Report, View } from "@/dataCatalog";

vi.mock("@/auth", () => ({
  withAuth: (f: typeof fetch) => f,
}));

vi.mock("@/dataCatalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/dataCatalog")>();
  return {
    ...actual,
    createDataCatalog: () => ({
      uploadFile: vi.fn(),
      updateDataset: vi.fn(),
    }),
  };
});

const datasetsForProject: Record<string, DatasetSparse[]> = {
  p1: [
    {
      id: "d1",
      name: "orders",
      link: "/api/datasets/d1",
      description: null,
      schema_config: { fields: {} },
      display_name: null,
    },
  ],
};

const viewsForProject: Record<string, View[]> = { p1: [] };
const reportsForProject: Record<string, Report[]> = { p1: [] };

vi.mock("../../hooks/useDatasetQuery", () => ({
  useDatasets: (projectId: string | undefined) => ({
    data: datasetsForProject[projectId ?? ""] ?? [],
    isLoading: false,
  }),
  // MR-7: PipelineLanding now also reads the archived set (cold storage).
  useArchivedDatasets: () => ({ data: [], isLoading: false }),
}));

vi.mock("../../hooks/useViewQuery", () => ({
  useViewsQuery: (projectId: string | undefined) => ({
    data: viewsForProject[projectId ?? ""] ?? [],
    isLoading: false,
  }),
}));

vi.mock("../../hooks/useReportQuery", () => ({
  useReportsQuery: (projectId: string | undefined) => ({
    data: reportsForProject[projectId ?? ""] ?? [],
    isLoading: false,
  }),
}));

import PipelineLanding from "./index";

function renderLandingAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Stub = createRoutesStub([
    { path: "projects/:projectId/pipeline", Component: PipelineLanding },
  ]);
  return render(
    <QueryClientProvider client={queryClient}>
      <Stub initialEntries={[path]} />
    </QueryClientProvider>,
  );
}

describe("Pipeline upload modal — toolbar trigger + source-node reopen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  it("opens a fresh upload modal from the pipeline toolbar", async () => {
    renderLandingAt("/projects/p1/pipeline");
    await screen.findByTestId("pipeline-canvas");

    fireEvent.click(screen.getByTestId("upload-source-button"));

    expect(screen.getByTestId("upload-modal")).toBeInTheDocument();
  });

  it("reopens the upload modal when a source node is activated", async () => {
    renderLandingAt("/projects/p1/pipeline");
    await screen.findByTestId("pipeline-canvas");

    fireEvent.click(screen.getByTestId("flow-node-d1"));

    expect(screen.getByTestId("upload-modal")).toBeInTheDocument();
  });
});
