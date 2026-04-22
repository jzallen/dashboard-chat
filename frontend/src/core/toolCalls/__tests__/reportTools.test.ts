import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Report } from "@/dataCatalog";

import { reportKeys } from "../../../lib/queryKeys";

// Mock the dataCatalog module
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

// Import after mocks
const { executeReportToolCall, handleSuggestStructure } = await import("../reportTools");

function makeContext(overrides?: Partial<ReturnType<typeof defaultContext>>) {
  return { ...defaultContext(), ...overrides };
}

function defaultContext() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    reportId: "report-1",
    projectId: "project-1",
    queryClient,
    navigate: vi.fn(),
    setContext: vi.fn(),
  };
}

function seedReport(queryClient: QueryClient, report: Partial<Report> = {}) {
  const full: Report = {
    id: "report-1",
    project_id: "project-1",
    org_id: "org-1",
    name: "Test Report",
    description: null,
    sql_definition: "SELECT id, name FROM users",
    report_type: "fact",
    source_refs: [{ id: "view-1", type: "view" }],
    domain: "Organization",
    columns_metadata: [],
    materialization: "view",
    created_at: null,
    updated_at: null,
    ...report,
  };
  queryClient.setQueryData(reportKeys.detail("report-1"), full);
  return full;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CRUD handlers", () => {
  it("handleCreateReport creates report and navigates", async () => {
    const ctx = makeContext();
    mockCreateReport.mockResolvedValue({ id: "new-report", name: "My Report" });

    const result = await executeReportToolCall(
      "createReport",
      {
        name: "My Report",
        sqlDefinition: "SELECT 1",
        reportType: "fact",
        sourceRefs: [{ id: "ds-1", type: "dataset" }],
        domain: "Finance",
      },
      ctx,
    );

    expect(result).toContain("Created report");
    expect(mockCreateReport).toHaveBeenCalledWith("project-1", expect.objectContaining({ name: "My Report" }));
    expect(ctx.navigate).toHaveBeenCalledWith("/report/new-report");
    expect(ctx.setContext).toHaveBeenCalledWith("report", "new-report");
  });

  it("handleRenameReport patches name", async () => {
    const ctx = makeContext();
    mockUpdateReport.mockResolvedValue({});

    const result = await executeReportToolCall("renameReport", { newName: "Renamed" }, ctx);

    expect(result).toContain("Renamed");
    expect(mockUpdateReport).toHaveBeenCalledWith("report-1", { name: "Renamed" });
  });

  it("handleDeleteReport deletes and navigates away", async () => {
    const ctx = makeContext();
    seedReport(ctx.queryClient);
    mockDeleteReport.mockResolvedValue(undefined);

    const result = await executeReportToolCall("deleteReport", {}, ctx);

    expect(result).toContain("Deleted report");
    expect(mockDeleteReport).toHaveBeenCalledWith("report-1");
    expect(ctx.setContext).toHaveBeenCalledWith(null, null);
    expect(ctx.navigate).toHaveBeenCalledWith("/");
  });
});

describe("structure handlers", () => {
  it("handleAddDimension adds a dimension to columns_metadata", async () => {
    const ctx = makeContext();
    seedReport(ctx.queryClient);
    mockUpdateReport.mockResolvedValue({});

    const result = await executeReportToolCall(
      "addDimension",
      { name: "region", semanticType: "categorical", description: "Geographic region" },
      ctx,
    );

    expect(result).toContain('Added dimension "region"');
    expect(mockUpdateReport).toHaveBeenCalledWith("report-1", {
      columns_metadata: [
        expect.objectContaining({
          name: "region",
          semantic_role: "dimension",
          semantic_type: "categorical",
        }),
      ],
    });
  });

  it("handleRemoveDimension removes dimension by name", async () => {
    const ctx = makeContext();
    seedReport(ctx.queryClient, {
      columns_metadata: [
        { name: "region", semantic_role: "dimension", semantic_type: "categorical" },
        { name: "revenue", semantic_role: "measure", semantic_type: "sum" },
      ],
    });
    mockUpdateReport.mockResolvedValue({});

    const result = await executeReportToolCall("removeDimension", { name: "region" }, ctx);

    expect(result).toContain('Removed dimension "region"');
    expect(mockUpdateReport).toHaveBeenCalledWith("report-1", {
      columns_metadata: [expect.objectContaining({ name: "revenue", semantic_role: "measure" })],
    });
  });

  it("handleAddMeasure adds a measure to columns_metadata", async () => {
    const ctx = makeContext();
    seedReport(ctx.queryClient);
    mockUpdateReport.mockResolvedValue({});

    const result = await executeReportToolCall(
      "addMeasure",
      { name: "total_revenue", semanticType: "sum", expr: "SUM(amount)" },
      ctx,
    );

    expect(result).toContain('Added measure "total_revenue"');
    expect(mockUpdateReport).toHaveBeenCalledWith("report-1", {
      columns_metadata: [
        expect.objectContaining({
          name: "total_revenue",
          semantic_role: "measure",
          semantic_type: "sum",
        }),
      ],
    });
  });

  it("handleRemoveMeasure removes measure by name", async () => {
    const ctx = makeContext();
    seedReport(ctx.queryClient, {
      columns_metadata: [
        { name: "total_revenue", semantic_role: "measure", semantic_type: "sum" },
      ],
    });
    mockUpdateReport.mockResolvedValue({});

    const result = await executeReportToolCall("removeMeasure", { name: "total_revenue" }, ctx);

    expect(result).toContain('Removed measure "total_revenue"');
    expect(mockUpdateReport).toHaveBeenCalledWith("report-1", { columns_metadata: [] });
  });
});

describe("config handlers", () => {
  it("handleSetMaterialization patches materialization", async () => {
    const ctx = makeContext();
    mockUpdateReport.mockResolvedValue({});

    const result = await executeReportToolCall("setMaterialization", { strategy: "table" }, ctx);

    expect(result).toContain('"table"');
    expect(mockUpdateReport).toHaveBeenCalledWith("report-1", { materialization: "table" });
  });

  it("handleSetDomain patches domain", async () => {
    const ctx = makeContext();
    mockUpdateReport.mockResolvedValue({});

    const result = await executeReportToolCall("setDomain", { domain: "Finance" }, ctx);

    expect(result).toContain('"Finance"');
    expect(mockUpdateReport).toHaveBeenCalledWith("report-1", { domain: "Finance" });
  });

  it("handleSetReportType patches report_type", async () => {
    const ctx = makeContext();
    mockUpdateReport.mockResolvedValue({});

    const result = await executeReportToolCall("setReportType", { reportType: "dimension" }, ctx);

    expect(result).toContain('"dimension"');
    expect(mockUpdateReport).toHaveBeenCalledWith("report-1", { report_type: "dimension" });
  });
});

describe("filter/join handlers", () => {
  it("handleAddFilter appends WHERE clause to SQL", async () => {
    const ctx = makeContext();
    seedReport(ctx.queryClient);
    mockUpdateReport.mockResolvedValue({});

    await executeReportToolCall("addFilter", { column: "status", operator: "=", value: "active" }, ctx);

    expect(mockUpdateReport).toHaveBeenCalledWith("report-1", {
      sql_definition: expect.stringContaining("WHERE status = 'active'"),
    });
  });

  it("handleAddFilter appends AND when WHERE exists", async () => {
    const ctx = makeContext();
    seedReport(ctx.queryClient, { sql_definition: "SELECT * FROM users WHERE org_id = '1'" });
    mockUpdateReport.mockResolvedValue({});

    await executeReportToolCall("addFilter", { column: "active", operator: "=", value: "true" }, ctx);

    expect(mockUpdateReport).toHaveBeenCalledWith("report-1", {
      sql_definition: expect.stringContaining("AND active = 'true'"),
    });
  });

  it("handleAddJoin appends JOIN and adds source ref", async () => {
    const ctx = makeContext();
    seedReport(ctx.queryClient);
    mockUpdateReport.mockResolvedValue({});

    await executeReportToolCall(
      "addJoin",
      {
        rightRef: { id: "ds-orders", type: "dataset" },
        leftColumn: "user_id",
        rightColumn: "id",
        joinType: "LEFT",
      },
      ctx,
    );

    expect(mockUpdateReport).toHaveBeenCalledWith("report-1", {
      source_refs: expect.arrayContaining([{ id: "ds-orders", type: "dataset" }]),
      sql_definition: expect.stringContaining("LEFT JOIN ds-orders ON user_id = id"),
    });
  });
});

describe("suggestStructure", () => {
  it("classifies columns by naming conventions", async () => {
    const result = await handleSuggestStructure({
      sourceColumns: [
        { name: "customer_id", type: "varchar" },
        { name: "created_at", type: "timestamp" },
        { name: "amount", type: "decimal" },
        { name: "region", type: "varchar" },
      ],
    });

    expect(result).toContain("customer_id");
    expect(result).toContain("entity");
    expect(result).toContain("created_at");
    expect(result).toContain("time");
    expect(result).toContain("amount");
    expect(result).toContain("measure");
    expect(result).toContain("region");
    expect(result).toContain("categorical");
  });
});

describe("dispatcher", () => {
  it("returns error for unknown tool", async () => {
    const ctx = makeContext();
    const result = await executeReportToolCall("unknownTool", {}, ctx);
    expect(result).toContain("Unknown report tool");
  });
});
