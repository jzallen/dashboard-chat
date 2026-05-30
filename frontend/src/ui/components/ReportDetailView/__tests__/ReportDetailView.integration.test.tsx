import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Report } from "@/dataCatalog";

import { reportKeys } from "../../../../lib/queryKeys";

/**
 * Integration test for ReportDetailView's tool-call flow.
 *
 * Simulates a chat tool-call SSE event reaching the view:
 *   1. Mount ReportDetailView — it registers an executeToolCall handler via
 *      the mocked ChatContext.
 *   2. Capture that handler (what the chat pipeline would invoke after
 *      parsing a `9:[{toolCallId,toolName,args}]` SSE event).
 *   3. Invoke it with a fake tool call (simulating the SSE-decoded payload).
 *   4. Verify the corresponding dataCatalog method was called (API mutation)
 *      and queryClient.invalidateQueries was called (cache invalidation).
 */

const mockCreateReport = vi.fn();
const mockUpdateReport = vi.fn();
const mockDeleteReport = vi.fn();

vi.mock("@/dataCatalog", () => ({
  createDataCatalog: () => ({
    createReport: mockCreateReport,
    updateReport: mockUpdateReport,
    deleteReport: mockDeleteReport,
  }),
}));

vi.mock("@/auth", () => ({
  withAuth: (f: typeof fetch) => f,
}));

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

interface ToolHandler {
  executeToolCall: (toolCall: {
    function: { name: string; arguments: string };
  }) => Promise<string>;
}

let capturedToolHandler: ToolHandler | null = null;

const mockSetContext = vi.fn();
const mockRegisterToolHandler = vi.fn((handler: ToolHandler | null) => {
  capturedToolHandler = handler;
});
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

const { ReportDetailView } = await import("..");

function mountView(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/report/report-1"]}>
        <Routes>
          <Route path="report/:reportId" element={<ReportDetailView />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function fakeToolCall(name: string, args: Record<string, unknown>) {
  return {
    function: { name, arguments: JSON.stringify(args) },
  };
}

describe("ReportDetailView — tool-call SSE integration", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedToolHandler = null;
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Seed the detail cache so handlers that read-modify-write can find the report.
    queryClient.setQueryData(reportKeys.detail("report-1"), mockReport);
  });

  it("renameReport tool call PATCHes the report and invalidates detail cache", async () => {
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    mockUpdateReport.mockResolvedValueOnce({ ...mockReport, name: "Renamed" });

    mountView(queryClient);

    expect(capturedToolHandler).not.toBeNull();

    const result = await capturedToolHandler!.executeToolCall(
      fakeToolCall("renameReport", { newName: "Renamed" }),
    );

    expect(mockUpdateReport).toHaveBeenCalledWith("report-1", { name: "Renamed" });
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: reportKeys.detail("report-1"), exact: true }),
    );
    expect(result).toContain("Renamed");
  });

  it("addDimension tool call appends to columns_metadata and invalidates cache", async () => {
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    mockUpdateReport.mockResolvedValueOnce(mockReport);

    mountView(queryClient);

    await capturedToolHandler!.executeToolCall(
      fakeToolCall("addDimension", { name: "region", semanticType: "categorical" }),
    );

    expect(mockUpdateReport).toHaveBeenCalledTimes(1);
    const [reportId, patch] = mockUpdateReport.mock.calls[0];
    expect(reportId).toBe("report-1");
    expect(patch.columns_metadata).toHaveLength(mockReport.columns_metadata.length + 1);
    expect(patch.columns_metadata[patch.columns_metadata.length - 1]).toMatchObject({
      name: "region",
      semantic_role: "dimension",
      semantic_type: "categorical",
    });
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: reportKeys.detail("report-1"), exact: true }),
    );
  });

  it("setMaterialization tool call PATCHes the materialization field", async () => {
    mockUpdateReport.mockResolvedValueOnce(mockReport);

    mountView(queryClient);

    const result = await capturedToolHandler!.executeToolCall(
      fakeToolCall("setMaterialization", { strategy: "table" }),
    );

    expect(mockUpdateReport).toHaveBeenCalledWith("report-1", { materialization: "table" });
    expect(result).toContain("table");
  });

  it("deleteReport tool call calls DELETE, invalidates list, and navigates away", async () => {
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    mockDeleteReport.mockResolvedValueOnce(undefined);

    mountView(queryClient);

    const result = await capturedToolHandler!.executeToolCall(
      fakeToolCall("deleteReport", {}),
    );

    expect(mockDeleteReport).toHaveBeenCalledWith("report-1");
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: reportKeys.list("proj-1") }),
    );
    expect(mockSetContext).toHaveBeenCalledWith(null, null);
    expect(result).toContain("Deleted");
  });

  it("unknown tool name returns an explanatory string without hitting the API", async () => {
    mountView(queryClient);

    const result = await capturedToolHandler!.executeToolCall(
      fakeToolCall("notARealTool", {}),
    );

    expect(mockUpdateReport).not.toHaveBeenCalled();
    expect(mockCreateReport).not.toHaveBeenCalled();
    expect(mockDeleteReport).not.toHaveBeenCalled();
    expect(result).toContain("Unknown report tool");
  });

  it("suggestStructure tool call returns suggestions without any API mutation", async () => {
    mountView(queryClient);

    const result = await capturedToolHandler!.executeToolCall(
      fakeToolCall("suggestStructure", {
        sourceColumns: [
          { name: "created_at", type: "timestamp" },
          { name: "amount", type: "decimal" },
          { name: "region", type: "varchar" },
        ],
      }),
    );

    expect(mockUpdateReport).not.toHaveBeenCalled();
    expect(result).toContain("Suggested structure");
    expect(result).toContain("created_at");
    expect(result).toContain("amount");
    expect(result).toContain("region");
  });
});
