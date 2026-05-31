import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { View } from "@/dataCatalog";

const mockView: View = {
  id: "view-1",
  project_id: "proj-1",
  org_id: "org-1",
  name: "Revenue Summary",
  description: "Monthly revenue aggregation",
  sql_definition: "SELECT s0.month FROM ref('stg_orders') AS s0",
  display_sql: "-- SQL Preview — for reference only\nSELECT CAST(s0.\"month\" AS text) AS \"month\" FROM orders AS s0",
  source_refs: [
    { id: "ds-1", type: "dataset" },
    { id: "view-2", type: "view" },
  ],
  columns: [
    { name: "month", source_ref: "ds-1", source_column: "month", display_type: "text", grain_role: null, alias: null },
    { name: "amount", source_ref: "ds-1", source_column: "amount", display_type: "decimal", grain_role: "Metric", alias: null },
  ],
  joins: [],
  filters: [],
  grain: { time_column: "month", dimensions: [] },
  materialization: "view",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};

// Mock hooks
const mockSetContext = vi.fn();
const mockRegisterToolHandler = vi.fn();

vi.mock("../../../context/ChatContext", () => ({
  useChatContext: () => ({
    messages: [],
    input: "",
    setInput: vi.fn(),
    isLoading: false,
    handleSubmit: vi.fn(),
    registerToolHandler: mockRegisterToolHandler,
    setContext: mockSetContext,
    channel: null,
    isStreaming: false,
    streamingContent: "",
  }),
}));

vi.mock("../../../hooks/useViewQuery", () => ({
  useViewQuery: (viewId: string | undefined) => ({
    data: viewId === "view-1" ? mockView : undefined,
    isLoading: false,
    isError: viewId !== "view-1",
  }),
}));

// MR-5: the dependency strip data comes from useModelDependencies (doubled here).
vi.mock("../../../hooks/useModelDependencies", () => ({
  useModelDependencies: () => ({
    upstream: [{ id: "ds-1", name: "Orders", kind: "dataset" }],
    downstream: [{ id: "report-9", name: "Revenue Report", kind: "report" }],
    isLoading: false,
  }),
}));

vi.mock("../../../hooks/queryKeys", () => ({
  viewKeys: {
    all: ["views"],
    lists: () => ["views", "list"],
    list: (projectId: string) => ["views", "list", projectId],
    details: () => ["views", "detail"],
    detail: (id: string) => ["views", "detail", id],
  },
}));

// Import after mocks
import { ViewDetailView } from "..";

function renderWithRouter(viewId: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Stub = createRoutesStub([
    { path: "/view/:viewId", Component: () => <ViewDetailView /> },
    { path: "/report/:reportId", Component: () => <div data-testid="report-destination">report detail</div> },
    { path: "/table/:datasetId", Component: () => <div data-testid="table-destination">table detail</div> },
  ]);
  return render(
    <QueryClientProvider client={queryClient}>
      <Stub initialEntries={[`/view/${viewId}`]} />
    </QueryClientProvider>,
  );
}

describe("ViewDetailView (MR-5 single-page model detail)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders inside the shared model-detail layout with name and materialization", () => {
    renderWithRouter("view-1");
    expect(screen.getByTestId("model-detail")).toBeInTheDocument();
    expect(screen.getByTestId("model-detail-title")).toHaveTextContent("Revenue Summary");
    expect(screen.getAllByText("view").length).toBeGreaterThanOrEqual(1);
  });

  it("renders description when present", () => {
    renderWithRouter("view-1");
    expect(screen.getByText("Monthly revenue aggregation")).toBeInTheDocument();
  });

  it("renders the dependency strip with links to upstream/downstream models", () => {
    renderWithRouter("view-1");
    expect(screen.getByTestId("dependency-strip")).toBeInTheDocument();
    expect(screen.getByTestId("dep-link-ds-1")).toHaveAttribute("href", "/table/ds-1");
    expect(screen.getByTestId("dep-link-report-9")).toHaveAttribute("href", "/report/report-9");
  });

  it("navigates to a dependency's detail route when its link is clicked", async () => {
    renderWithRouter("view-1");
    fireEvent.click(screen.getByTestId("dep-link-report-9"));
    expect(await screen.findByTestId("report-destination")).toBeInTheDocument();
  });

  it("renders the Assistant-changes audit panel (empty-state with no changes)", () => {
    renderWithRouter("view-1");
    expect(screen.getByTestId("assistant-changes-panel")).toBeInTheDocument();
    expect(screen.getByTestId("assistant-changes-empty")).toBeInTheDocument();
  });

  it("renders the data preview section with a documented empty-state for views", () => {
    renderWithRouter("view-1");
    expect(screen.getByTestId("data-preview")).toBeInTheDocument();
    expect(screen.getByTestId("data-preview-unavailable")).toBeInTheDocument();
  });

  it("renders the columns/measures table", () => {
    renderWithRouter("view-1");
    expect(screen.getByTestId("view-schema-table")).toBeInTheDocument();
    expect(screen.getByText("month")).toBeInTheDocument();
    expect(screen.getByText("amount")).toBeInTheDocument();
    expect(screen.getByText("Metric")).toBeInTheDocument();
  });

  it("renders the compiled SQL panel and reveals the SQL with ref() wiring on toggle", () => {
    renderWithRouter("view-1");
    expect(screen.getByTestId("compiled-sql")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("compiled-sql-toggle"));
    const content = screen.getByTestId("compiled-sql-content");
    expect(content.textContent).toContain("ref('stg_orders')");
  });

  it("shows error state for unknown view", () => {
    renderWithRouter("unknown-id");
    expect(screen.getByText("View not found")).toBeInTheDocument();
  });

  it("sets context on mount and clears on unmount", () => {
    const { unmount } = renderWithRouter("view-1");
    expect(mockSetContext).toHaveBeenCalledWith("view", "view-1");
    unmount();
    expect(mockSetContext).toHaveBeenCalledWith(null, null);
  });

  it("registers and unregisters tool handler", () => {
    const { unmount } = renderWithRouter("view-1");
    expect(mockRegisterToolHandler).toHaveBeenCalledWith(
      expect.objectContaining({ executeToolCall: expect.any(Function) }),
    );
    unmount();
    expect(mockRegisterToolHandler).toHaveBeenCalledWith(null);
  });

  it("renders chat input with view context label", () => {
    renderWithRouter("view-1");
    expect(screen.getByTestId("chat-input")).toBeInTheDocument();
  });
});
