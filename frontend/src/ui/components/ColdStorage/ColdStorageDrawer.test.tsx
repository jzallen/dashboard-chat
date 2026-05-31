// ColdStorageDrawer — the "fridge" (MR-7). RED until DELIVER 07-03.
//
// Port-boundary doubles: the archived-datasets query hook + the restore mutation hook are
// mocked at the hook boundary (mirrors PipelineLanding.test). happy-dom asserts structure /
// testids / rendered values, not computed colors (DWD-M7-2). The days-left math itself is
// unit-tested in core/coldStorage/__tests__/daysLeft.test.ts — here we only assert the badge
// renders.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DatasetSparse } from "@/dataCatalog";

import { ColdStorageDrawer } from "./ColdStorageDrawer";

const mockRestore = vi.fn();

const archivedState: { data: DatasetSparse[]; isLoading: boolean } = {
  data: [],
  isLoading: false,
};

vi.mock("../../hooks/useDatasetQuery", () => ({
  useArchivedDatasets: () => archivedState,
}));

vi.mock("../../hooks/useDatasetMutations", () => ({
  useRestoreDataset: () => ({ mutate: mockRestore }),
}));

function archived(overrides: Partial<DatasetSparse> = {}): DatasetSparse {
  return {
    id: "ds-1",
    name: "orders_raw",
    link: "/api/datasets/ds-1",
    description: null,
    schema_config: { fields: {} },
    display_name: null,
    archived_at: "2026-05-20T00:00:00.000Z",
    retention_until: "2026-08-18T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  mockRestore.mockReset();
  archivedState.data = [];
  archivedState.isLoading = false;
});

describe("ColdStorageDrawer — the fridge", () => {
  it("renders nothing while closed", () => {
    render(<ColdStorageDrawer open={false} projectId="p1" onClose={() => {}} />);
    expect(screen.queryByTestId("cold-storage-drawer")).not.toBeInTheDocument();
  });

  it("lists each archived source with retired-at, retention-end, days-left and a restore button", () => {
    archivedState.data = [archived()];
    render(<ColdStorageDrawer open projectId="p1" onClose={() => {}} />);

    expect(screen.getByTestId("cold-storage-drawer")).toBeInTheDocument();
    expect(screen.getByTestId("cold-storage-row-ds-1")).toBeInTheDocument();
    expect(screen.getByTestId("cold-storage-retired-at-ds-1")).toBeInTheDocument();
    expect(screen.getByTestId("cold-storage-retention-end-ds-1")).toBeInTheDocument();
    expect(screen.getByTestId("cold-storage-days-left-ds-1")).toBeInTheDocument();
    expect(screen.getByTestId("cold-storage-restore-ds-1")).toBeInTheDocument();
  });

  it("shows the display name, falling back to the source name when unset", () => {
    archivedState.data = [archived({ display_name: "Orders (raw)" })];
    render(<ColdStorageDrawer open projectId="p1" onClose={() => {}} />);
    expect(screen.getByTestId("cold-storage-row-ds-1")).toHaveTextContent("Orders (raw)");
  });

  it("fires the restore mutation when a row's restore button is clicked", () => {
    archivedState.data = [archived()];
    render(<ColdStorageDrawer open projectId="p1" onClose={() => {}} />);

    fireEvent.click(screen.getByTestId("cold-storage-restore-ds-1"));
    expect(mockRestore).toHaveBeenCalledWith({ datasetId: "ds-1" });
  });

  it("renders a playful empty state when nothing is in cold storage", () => {
    archivedState.data = [];
    render(<ColdStorageDrawer open projectId="p1" onClose={() => {}} />);

    expect(screen.getByTestId("cold-storage-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("cold-storage-row-ds-1")).not.toBeInTheDocument();
  });
});
