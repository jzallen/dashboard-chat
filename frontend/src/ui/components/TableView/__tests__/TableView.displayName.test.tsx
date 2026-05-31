import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "@/dataCatalog";

// MR-6 — the dataset-detail surface mounts the reusable DisplayNameEditor so a
// source's display name is editable in place (DWD-M6-7). The editor input falls back
// to the raw `name` when display_name is null. The mutation hook is doubled at the
// boundary; the other TableView ports mirror TableView.detail.test.
const mockDataset: Dataset = {
  id: "ds-1",
  project_id: "proj-1",
  name: "Raw Orders",
  description: null,
  schema_config: {
    fields: {
      order_id: { label: "Order ID", type: "number" },
    },
  },
  partition_fields: [],
  transforms: [],
  preview_rows: [],
  staging_sql: "SELECT order_id FROM ref('raw_orders')",
  column_profiles: null,
  format_context: null,
  display_name: null,
};

vi.mock("../../../context/ChatContext", () => ({
  useChatContext: () => ({
    messages: [],
    input: "",
    setInput: vi.fn(),
    isLoading: false,
    handleSubmit: vi.fn(),
    registerTableApi: vi.fn(),
    registerTableSchema: vi.fn(),
    setContext: vi.fn(),
    channel: null,
    isStreaming: false,
    streamingContent: "",
  }),
}));

vi.mock("../../../hooks/useDatasetQuery", () => ({
  useDatasetQuery: (datasetId: string | undefined) => ({
    data: datasetId === "ds-1" ? mockDataset : undefined,
    isLoading: false,
  }),
}));

vi.mock("../../../hooks/useTableConfig", () => ({
  useTableConfig: () => ({
    table: {},
    data: [],
    columnFilters: [],
    setColumnFilters: vi.fn(),
    sorting: [],
    setSorting: vi.fn(),
    columnVisibility: {},
    setColumnVisibility: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("../../../hooks/useTransforms", () => ({
  useTransforms: () => ({ toggleTransform: vi.fn() }),
}));

vi.mock("../../../hooks/useModelDependencies", () => ({
  useModelDependencies: () => ({ upstream: [], downstream: [], isLoading: false }),
}));

vi.mock("../../../hooks/useDatasetMutations", () => ({
  useUpdateDatasetDisplayName: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("../../TablePanel", () => ({
  default: () => <div data-testid="data-table">table panel</div>,
}));

import { TableView } from "..";

function renderWithRouter(datasetId: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Stub = createRoutesStub([
    { path: "/table/:datasetId", Component: () => <TableView /> },
  ]);
  return render(
    <QueryClientProvider client={queryClient}>
      <Stub initialEntries={[`/table/${datasetId}`]} />
    </QueryClientProvider>,
  );
}

describe("TableView — editable source display name (MR-6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mounts the display-name editor seeded from the raw name when display_name is null", () => {
    renderWithRouter("ds-1");
    expect(screen.getByTestId("display-name-input")).toHaveValue("Raw Orders");
  });
});
