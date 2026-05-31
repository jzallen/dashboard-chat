import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Report } from "@/dataCatalog";

const mockReport: Report = {
  id: "report-1",
  project_id: "proj-1",
  org_id: "org-1",
  name: "Monthly Revenue",
  description: "Monthly revenue fact table",
  sql_definition: "SELECT month, SUM(amount) AS revenue FROM ref('int_orders') GROUP BY month",
  report_type: "fact",
  source_refs: [
    { id: "view-2", type: "view" },
    { id: "ds-1", type: "dataset" },
  ],
  domain: "Finance",
  columns_metadata: [
    { name: "month", semantic_role: "dimension", semantic_type: "time", time_granularity: "month" },
    { name: "revenue", semantic_role: "measure", semantic_type: "sum" },
  ],
  materialization: "view",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};

const mockSetContext = vi.fn();
const mockRegisterToolHandler = vi.fn();
const mockRegisterTableSchema = vi.fn();

vi.mock("../../../context/ChatContext", () => ({
  useChatContext: () => ({
    messages: [],
    input: "",
    setInput: vi.fn(),
    isLoading: false,
    handleSubmit: vi.fn(),
    registerToolHandler: mockRegisterToolHandler,
    registerTableSchema: mockRegisterTableSchema,
    setContext: mockSetContext,
    channel: null,
    isStreaming: false,
    streamingContent: "",
  }),
}));

vi.mock("../../../hooks/useReportQuery", () => ({
  useReportQuery: (reportId: string | undefined) => ({
    data: reportId === "report-1" ? mockReport : undefined,
    isLoading: false,
    isError: reportId !== "report-1",
  }),
}));

// MR-5: the dependency strip data comes from useModelDependencies (doubled here).
vi.mock("../../../hooks/useModelDependencies", () => ({
  useModelDependencies: () => ({
    upstream: [{ id: "view-2", name: "Order View", kind: "view" }],
    downstream: [],
    isLoading: false,
  }),
}));

import { ReportDetailView } from "..";

function renderWithRouter(reportId: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Stub = createRoutesStub([
    { path: "/report/:reportId", Component: () => <ReportDetailView /> },
    { path: "/view/:viewId", Component: () => <div data-testid="view-destination">view detail</div> },
  ]);
  return render(
    <QueryClientProvider client={queryClient}>
      <Stub initialEntries={[`/report/${reportId}`]} />
    </QueryClientProvider>,
  );
}

describe("ReportDetailView (MR-5 single-page model detail)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders inside the shared model-detail layout with name and badges", () => {
    renderWithRouter("report-1");
    expect(screen.getByTestId("model-detail")).toBeInTheDocument();
    expect(screen.getByTestId("model-detail-title")).toHaveTextContent("Monthly Revenue");
    expect(screen.getByText("fact")).toBeInTheDocument();
    expect(screen.getByText("Finance")).toBeInTheDocument();
  });

  it("renders description when present", () => {
    renderWithRouter("report-1");
    expect(screen.getByText("Monthly revenue fact table")).toBeInTheDocument();
  });

  it("renders the dependency strip with a link to the upstream view", () => {
    renderWithRouter("report-1");
    expect(screen.getByTestId("dependency-strip")).toBeInTheDocument();
    expect(screen.getByTestId("dep-link-view-2")).toHaveAttribute("href", "/view/view-2");
  });

  it("navigates to a dependency's detail route when its link is clicked", async () => {
    renderWithRouter("report-1");
    fireEvent.click(screen.getByTestId("dep-link-view-2"));
    expect(await screen.findByTestId("view-destination")).toBeInTheDocument();
  });

  it("renders the Assistant-changes audit panel", () => {
    renderWithRouter("report-1");
    expect(screen.getByTestId("assistant-changes-panel")).toBeInTheDocument();
  });

  it("renders the data preview section with a documented empty-state for reports", () => {
    renderWithRouter("report-1");
    expect(screen.getByTestId("data-preview")).toBeInTheDocument();
    expect(screen.getByTestId("data-preview-unavailable")).toBeInTheDocument();
  });

  it("renders the columns metadata table with role and type", () => {
    renderWithRouter("report-1");
    expect(screen.getByTestId("columns-metadata-table")).toBeInTheDocument();
    expect(screen.getByText("month")).toBeInTheDocument();
    expect(screen.getByText("revenue")).toBeInTheDocument();
    expect(screen.getByText("sum")).toBeInTheDocument();
  });

  it("renders the compiled SQL panel and reveals the SQL with ref() wiring on toggle", () => {
    renderWithRouter("report-1");
    expect(screen.getByTestId("compiled-sql")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("compiled-sql-toggle"));
    expect(screen.getByTestId("compiled-sql-content").textContent).toContain("ref('int_orders')");
  });

  it("shows error state for unknown report", () => {
    renderWithRouter("unknown-id");
    expect(screen.getByText("Report not found")).toBeInTheDocument();
  });

  it("sets context on mount and clears on unmount", () => {
    const { unmount } = renderWithRouter("report-1");
    expect(mockSetContext).toHaveBeenCalledWith("report", "report-1");
    unmount();
    expect(mockSetContext).toHaveBeenCalledWith(null, null);
  });

  it("registers and unregisters tool handler", () => {
    const { unmount } = renderWithRouter("report-1");
    expect(mockRegisterToolHandler).toHaveBeenCalledWith(
      expect.objectContaining({ executeToolCall: expect.any(Function) }),
    );
    unmount();
    expect(mockRegisterToolHandler).toHaveBeenCalledWith(null);
  });

  it("publishes tableSchema with report layerContext", () => {
    renderWithRouter("report-1");
    expect(mockRegisterTableSchema).toHaveBeenCalledWith(
      expect.objectContaining({
        layerContext: expect.objectContaining({
          layer: "report",
          modelName: "Monthly Revenue",
          sqlDefinition: expect.stringContaining("SELECT month"),
          sourceSchemas: ["view:view-2", "dataset:ds-1"],
        }),
      }),
    );
  });
});
