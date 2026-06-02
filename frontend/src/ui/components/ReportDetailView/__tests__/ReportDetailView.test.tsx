import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Report } from "@/dataCatalog";

const mockReport: Report = {
  id: "report-1",
  project_id: "proj-1",
  org_id: "org-1",
  name: "Monthly Revenue",
  description: "Monthly revenue fact table",
  sql_definition: "SELECT month, SUM(amount) AS revenue FROM view_2 GROUP BY month",
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

function renderWithRouter(reportId: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/report/${reportId}`]}>
        <Routes>
          <Route path="report/:reportId" element={<ReportDetailView />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

import { ReportDetailView } from "..";

describe("ReportDetailView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders report name and badges", () => {
    renderWithRouter("report-1");
    expect(screen.getByText("Monthly Revenue")).toBeInTheDocument();
    expect(screen.getByText("fact")).toBeInTheDocument();
    expect(screen.getByText("Finance")).toBeInTheDocument();
  });

  it("renders description when present", () => {
    renderWithRouter("report-1");
    expect(screen.getByText("Monthly revenue fact table")).toBeInTheDocument();
  });

  it("renders columns metadata table with role and type", () => {
    renderWithRouter("report-1");
    expect(screen.getByTestId("columns-metadata-table")).toBeInTheDocument();
    expect(screen.getByText("month")).toBeInTheDocument();
    expect(screen.getByText("revenue")).toBeInTheDocument();
    expect(screen.getByText("sum")).toBeInTheDocument();
  });

  it("renders source dependency links with correct hrefs", () => {
    renderWithRouter("report-1");
    const list = screen.getByTestId("source-dependency-list");
    const links = list.querySelectorAll("a");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/view/view-2");
    expect(links[1]).toHaveAttribute("href", "/table/ds-1");
  });

  it("SQL preview panel toggles on click", () => {
    renderWithRouter("report-1");
    expect(screen.queryByTestId("sql-preview-content")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("sql-preview-toggle"));
    expect(screen.getByTestId("sql-preview-content")).toBeInTheDocument();
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

  it("clears tableSchema on unmount", () => {
    const { unmount } = renderWithRouter("report-1");
    mockRegisterTableSchema.mockClear();
    unmount();
    expect(mockRegisterTableSchema).toHaveBeenCalledWith(null);
  });
});
