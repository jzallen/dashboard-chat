import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "@/dataCatalog";

// MR-5 — the dataset layer's single-page model detail. TableView keeps its
// interactive data grid (TablePanel = the data-preview) and gains the shared
// deps strip + audit panel + columns table + compiled SQL sections. The heavy
// table hooks are doubled at the boundary; TablePanel is stubbed (its TanStack
// table behavior is covered by its own tests).
const mockDataset: Dataset = {
  id: "ds-1",
  project_id: "proj-1",
  name: "Raw Orders",
  description: null,
  schema_config: {
    fields: {
      order_id: { label: "Order ID", type: "number" },
      status: { label: "Status", type: "text" },
    },
  },
  partition_fields: [],
  transforms: [],
  preview_rows: [{ order_id: 1, status: "active" }],
  staging_sql: "SELECT order_id, status FROM ref('raw_orders')",
  column_profiles: null,
  format_context: null,
};

const mockSetContext = vi.fn();

vi.mock("../../../context/ChatContext", () => ({
  useChatContext: () => ({
    messages: [],
    input: "",
    setInput: vi.fn(),
    isLoading: false,
    handleSubmit: vi.fn(),
    registerTableApi: vi.fn(),
    registerTableSchema: vi.fn(),
    setContext: mockSetContext,
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
    data: [{ order_id: 1, status: "active" }],
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
  useModelDependencies: () => ({
    upstream: [],
    downstream: [{ id: "view-9", name: "Order View", kind: "view" }],
    isLoading: false,
  }),
}));

vi.mock("../../TablePanel", () => ({
  default: () => <div data-testid="data-table">table panel</div>,
}));

import { TableView } from "..";

function renderWithRouter(datasetId: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Stub = createRoutesStub([
    { path: "/table/:datasetId", Component: () => <TableView /> },
    { path: "/view/:viewId", Component: () => <div data-testid="view-destination">view detail</div> },
  ]);
  return render(
    <QueryClientProvider client={queryClient}>
      <Stub initialEntries={[`/table/${datasetId}`]} />
    </QueryClientProvider>,
  );
}

describe("TableView (MR-5 single-page dataset detail)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders inside the shared model-detail layout with the dataset name", () => {
    renderWithRouter("ds-1");
    expect(screen.getByTestId("model-detail")).toBeInTheDocument();
    expect(screen.getByTestId("model-detail-title")).toHaveTextContent("Raw Orders");
  });

  it("renders the dependency strip with a link to a downstream consumer", () => {
    renderWithRouter("ds-1");
    expect(screen.getByTestId("dependency-strip")).toBeInTheDocument();
    expect(screen.getByTestId("dep-link-view-9")).toHaveAttribute("href", "/view/view-9");
  });

  it("navigates to a downstream model's detail route when its link is clicked", async () => {
    renderWithRouter("ds-1");
    fireEvent.click(screen.getByTestId("dep-link-view-9"));
    expect(await screen.findByTestId("view-destination")).toBeInTheDocument();
  });

  it("renders the Assistant-changes audit panel", () => {
    renderWithRouter("ds-1");
    expect(screen.getByTestId("assistant-changes-panel")).toBeInTheDocument();
  });

  it("renders the data preview section containing the interactive table grid", () => {
    renderWithRouter("ds-1");
    expect(screen.getByTestId("data-preview")).toBeInTheDocument();
    expect(screen.getByTestId("data-table")).toBeInTheDocument();
  });

  it("renders the dataset columns table from the schema", () => {
    renderWithRouter("ds-1");
    expect(screen.getByTestId("dataset-columns-table")).toBeInTheDocument();
    expect(screen.getByText("order_id")).toBeInTheDocument();
    expect(screen.getByText("status")).toBeInTheDocument();
  });

  it("renders the compiled SQL (staging) panel and reveals the SQL on toggle", () => {
    renderWithRouter("ds-1");
    expect(screen.getByTestId("compiled-sql")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("compiled-sql-toggle"));
    expect(screen.getByTestId("compiled-sql-content").textContent).toContain("ref('raw_orders')");
  });

  it("sets dataset context on mount and clears on unmount", () => {
    const { unmount } = renderWithRouter("ds-1");
    expect(mockSetContext).toHaveBeenCalledWith("dataset", "ds-1");
    unmount();
    expect(mockSetContext).toHaveBeenCalledWith(null, null);
  });

  it("renders the chat input bar", () => {
    renderWithRouter("ds-1");
    expect(screen.getByTestId("chat-input")).toBeInTheDocument();
  });
});
