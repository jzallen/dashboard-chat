// PipelineColdStorage — the live archived-set wiring + fridge (MR-7). RED until DELIVER 07-03.
//
// Proves MR-7's load-bearing lineage premise: PipelineLanding feeds the REAL archived id set
// (from useArchivedDatasets) into the EXISTING buildGraph archived seam (MR-2 passed an empty
// set), so an archived source LEAVES the live graph and its downstream goes orphaned; the
// fridge toolbar opens the cold-storage drawer; restore fires the restore mutation. The data
// hooks + mutations are mocked at the port boundary (mirrors PipelineLanding.test). happy-dom
// asserts structure / aria-disabled / testids, not computed colors (DWD-M7-2).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DatasetSparse, Report, View } from "@/dataCatalog";

import PipelineLanding from "./index";

const mockArchive = vi.fn();
const mockRestore = vi.fn();

// d1 = a live source; d2 = an archived source (excluded from the default/live list, present
// in the archived list). v1 depends ONLY on the archived d2 → orphaned once d2 is gone.
const liveDatasets: DatasetSparse[] = [
  { id: "d1", name: "orders", link: "/api/datasets/d1", description: null, schema_config: { fields: {} } },
];

const archivedDatasets: DatasetSparse[] = [
  {
    id: "d2",
    name: "legacy_orders",
    link: "/api/datasets/d2",
    description: null,
    schema_config: { fields: {} },
    display_name: null,
    archived_at: "2026-05-20T00:00:00.000Z",
    retention_until: "2026-08-18T00:00:00.000Z",
  },
];

const views: View[] = [
  {
    id: "v1",
    project_id: "p1",
    org_id: "org-1",
    name: "int_legacy",
    description: null,
    sql_definition: "SELECT 1",
    source_refs: [{ id: "d2", type: "dataset" }],
    columns: [],
    joins: [],
    filters: [],
    grain: null,
    materialization: "view",
    created_at: null,
    updated_at: null,
  },
];

const reports: Report[] = [];

vi.mock("../../hooks/useDatasetQuery", () => ({
  useDatasets: () => ({ data: liveDatasets, isLoading: false }),
  useArchivedDatasets: () => ({ data: archivedDatasets, isLoading: false }),
}));

vi.mock("../../hooks/useViewQuery", () => ({
  useViewsQuery: () => ({ data: views, isLoading: false }),
}));

vi.mock("../../hooks/useReportQuery", () => ({
  useReportsQuery: () => ({ data: reports, isLoading: false }),
}));

vi.mock("../../hooks/useDatasetMutations", () => ({
  useArchiveDataset: () => ({ mutate: mockArchive }),
  useRestoreDataset: () => ({ mutate: mockRestore }),
}));

function renderLanding() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Stub = createRoutesStub([
    { path: "projects/:projectId/pipeline", Component: PipelineLanding },
  ]);
  return render(
    <QueryClientProvider client={queryClient}>
      <Stub initialEntries={["/projects/p1/pipeline"]} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  mockArchive.mockReset();
  mockRestore.mockReset();
});

describe("PipelineLanding — cold storage / live archived set", () => {
  it("drops the archived source from the live graph and orphans its downstream", async () => {
    renderLanding();

    expect(await screen.findByTestId("pipeline-canvas")).toBeInTheDocument();
    // The live source still renders.
    expect(screen.getByTestId("flow-node-d1")).toBeInTheDocument();
    // The archived source has left the live graph.
    expect(screen.queryByTestId("flow-node-d2")).not.toBeInTheDocument();
    // Its downstream view is now orphaned (zero live inputs).
    expect(screen.getByTestId("flow-node-v1")).toHaveAttribute("aria-disabled", "true");
  });

  it("opens the fridge drawer from the toolbar and lists the archived source", async () => {
    renderLanding();
    await screen.findByTestId("pipeline-canvas");

    fireEvent.click(screen.getByTestId("fridge-toolbar-button"));

    expect(screen.getByTestId("cold-storage-drawer")).toBeInTheDocument();
    expect(screen.getByTestId("cold-storage-row-d2")).toBeInTheDocument();
  });

  it("@walking_skeleton archiving leaves the source out of the live lineage; restoring it from the fridge fires the restore mutation", async () => {
    renderLanding();
    await screen.findByTestId("pipeline-canvas");

    // The archived source is absent from the live graph and its downstream is orphaned.
    expect(screen.queryByTestId("flow-node-d2")).not.toBeInTheDocument();
    expect(screen.getByTestId("flow-node-v1")).toHaveAttribute("aria-disabled", "true");

    // Open the fridge and restore the archived source.
    fireEvent.click(screen.getByTestId("fridge-toolbar-button"));
    fireEvent.click(screen.getByTestId("cold-storage-restore-d2"));

    expect(mockRestore).toHaveBeenCalledWith({ datasetId: "d2" });
  });
});
