import type { QueryClient } from "@tanstack/react-query";

import { withAuth } from "@/auth";
import {
  createDataCatalog,
  type ColumnMetadata,
  type Report,
  type ReportCreate,
  type ReportUpdate,
} from "@/dataCatalog";

import { reportKeys } from "../../lib/queryKeys";

const catalog = createDataCatalog(withAuth(fetch));

export interface ReportToolContext {
  reportId: string;
  projectId: string;
  queryClient: QueryClient;
  navigate: (path: string) => void;
  setContext: (type: "view" | "dataset" | "report" | null, id: string | null) => void;
}

/** Read-modify-write helper: patches a report via API and invalidates cache. */
async function patchReport(
  queryClient: QueryClient,
  reportId: string,
  patch: ReportUpdate,
): Promise<string> {
  await catalog.updateReport(reportId, patch);
  queryClient.invalidateQueries({ queryKey: reportKeys.detail(reportId), exact: true });
  return "Done";
}

/** Read columns_metadata from cache, apply updater, and PATCH. */
async function patchColumnsMetadata(
  queryClient: QueryClient,
  reportId: string,
  updater: (cols: ColumnMetadata[]) => ColumnMetadata[],
): Promise<string> {
  const current = queryClient.getQueryData<Report>(reportKeys.detail(reportId));
  const newCols = updater(current?.columns_metadata ?? []);
  return patchReport(queryClient, reportId, { columns_metadata: newCols });
}

// ============================================================================
// CRUD Handlers
// ============================================================================

export async function handleCreateReport(
  args: {
    name: string;
    sqlDefinition: string;
    reportType: "fact" | "dimension";
    sourceRefs: Array<{ id: string; type: "dataset" | "view" }>;
    domain: string;
    description?: string;
    materialization?: "ephemeral" | "view" | "table" | "incremental";
  },
  context: ReportToolContext,
): Promise<string> {
  const data: ReportCreate = {
    name: args.name,
    sql_definition: args.sqlDefinition,
    report_type: args.reportType,
    source_refs: args.sourceRefs,
    domain: args.domain,
    description: args.description,
    materialization: args.materialization,
  };
  const report = await catalog.createReport(context.projectId, data);
  context.queryClient.invalidateQueries({ queryKey: reportKeys.list(context.projectId) });
  context.setContext("report", report.id);
  context.navigate(`/report/${report.id}`);
  return `Created report "${report.name}"`;
}

export async function handleRenameReport(
  args: { newName: string },
  context: ReportToolContext,
): Promise<string> {
  await patchReport(context.queryClient, context.reportId, { name: args.newName });
  return `Renamed report to "${args.newName}"`;
}

export async function handleDeleteReport(
  context: ReportToolContext,
): Promise<string> {
  const current = context.queryClient.getQueryData<Report>(reportKeys.detail(context.reportId));
  const name = current?.name ?? context.reportId;
  await catalog.deleteReport(context.reportId);
  context.queryClient.invalidateQueries({ queryKey: reportKeys.list(context.projectId) });
  context.setContext(null, null);
  context.navigate("/");
  return `Deleted report "${name}"`;
}

// ============================================================================
// Structure Handlers (dimensions & measures)
// ============================================================================

export async function handleAddDimension(
  args: {
    name: string;
    semanticType: "categorical" | "time";
    description?: string;
    expr?: string;
    timeGranularity?: string;
  },
  context: ReportToolContext,
): Promise<string> {
  const col: ColumnMetadata = {
    name: args.name,
    semantic_role: "dimension",
    semantic_type: args.semanticType,
    description: args.description,
    expr: args.expr,
    time_granularity: args.timeGranularity,
  };
  await patchColumnsMetadata(context.queryClient, context.reportId, (cols) => [...cols, col]);
  return `Added dimension "${args.name}" (${args.semanticType})`;
}

export async function handleRemoveDimension(
  args: { name: string },
  context: ReportToolContext,
): Promise<string> {
  await patchColumnsMetadata(context.queryClient, context.reportId, (cols) =>
    cols.filter((c) => !(c.name === args.name && c.semantic_role === "dimension")),
  );
  return `Removed dimension "${args.name}"`;
}

export async function handleAddMeasure(
  args: {
    name: string;
    semanticType: string;
    description?: string;
    expr?: string;
  },
  context: ReportToolContext,
): Promise<string> {
  const col: ColumnMetadata = {
    name: args.name,
    semantic_role: "measure",
    semantic_type: args.semanticType,
    description: args.description,
    expr: args.expr,
  };
  await patchColumnsMetadata(context.queryClient, context.reportId, (cols) => [...cols, col]);
  return `Added measure "${args.name}" (${args.semanticType})`;
}

export async function handleRemoveMeasure(
  args: { name: string },
  context: ReportToolContext,
): Promise<string> {
  await patchColumnsMetadata(context.queryClient, context.reportId, (cols) =>
    cols.filter((c) => !(c.name === args.name && c.semantic_role === "measure")),
  );
  return `Removed measure "${args.name}"`;
}

// ============================================================================
// Config Handlers
// ============================================================================

export async function handleSetMaterialization(
  args: { strategy: "ephemeral" | "view" | "table" | "incremental" },
  context: ReportToolContext,
): Promise<string> {
  await patchReport(context.queryClient, context.reportId, { materialization: args.strategy });
  return `Materialization set to "${args.strategy}"`;
}

export async function handleSetDomain(
  args: { domain: string },
  context: ReportToolContext,
): Promise<string> {
  await patchReport(context.queryClient, context.reportId, { domain: args.domain });
  return `Domain set to "${args.domain}"`;
}

export async function handleSetReportType(
  args: { reportType: "fact" | "dimension" },
  context: ReportToolContext,
): Promise<string> {
  await patchReport(context.queryClient, context.reportId, { report_type: args.reportType });
  return `Report type set to "${args.reportType}"`;
}

// ============================================================================
// Filter/Join Handlers
// ============================================================================

export async function handleAddFilter(
  args: { column: string; operator: string; value?: string },
  context: ReportToolContext,
): Promise<string> {
  const current = context.queryClient.getQueryData<Report>(reportKeys.detail(context.reportId));
  const sql = current?.sql_definition ?? "";
  const whereClause = args.value
    ? `${args.column} ${args.operator} '${args.value}'`
    : `${args.column} ${args.operator}`;
  const newSql = sql.toUpperCase().includes("WHERE")
    ? `${sql} AND ${whereClause}`
    : `${sql} WHERE ${whereClause}`;
  await patchReport(context.queryClient, context.reportId, { sql_definition: newSql });
  return `Added filter: ${whereClause}`;
}

export async function handleRemoveFilter(
  args: { column: string },
  context: ReportToolContext,
): Promise<string> {
  const current = context.queryClient.getQueryData<Report>(reportKeys.detail(context.reportId));
  const sql = current?.sql_definition ?? "";
  // Remove filter conditions mentioning the column from WHERE clause
  const regex = new RegExp(
    `\\s*(?:AND\\s+)?${args.column}\\s+[^\\s]+(?:\\s+'[^']*')?`,
    "gi",
  );
  const newSql = sql.replace(regex, "");
  await patchReport(context.queryClient, context.reportId, { sql_definition: newSql });
  return `Removed filter on "${args.column}"`;
}

export async function handleAddJoin(
  args: {
    rightRef: { id: string; type: "dataset" | "view" };
    leftColumn: string;
    rightColumn: string;
    joinType?: string;
  },
  context: ReportToolContext,
): Promise<string> {
  const current = context.queryClient.getQueryData<Report>(reportKeys.detail(context.reportId));
  const newSourceRefs = [...(current?.source_refs ?? [])];
  if (!newSourceRefs.find((r) => r.id === args.rightRef.id)) {
    newSourceRefs.push(args.rightRef);
  }
  const joinClause = `${args.joinType ?? "INNER"} JOIN ${args.rightRef.id} ON ${args.leftColumn} = ${args.rightColumn}`;
  const sql = current?.sql_definition ?? "";
  const newSql = `${sql} ${joinClause}`;
  await patchReport(context.queryClient, context.reportId, {
    source_refs: newSourceRefs,
    sql_definition: newSql,
  });
  return `Added ${args.joinType ?? "INNER"} join to "${args.rightRef.id}"`;
}

export async function handleRemoveJoin(
  args: { rightRefId: string },
  context: ReportToolContext,
): Promise<string> {
  const current = context.queryClient.getQueryData<Report>(reportKeys.detail(context.reportId));
  const newSourceRefs = (current?.source_refs ?? []).filter((r) => r.id !== args.rightRefId);
  // Remove JOIN clause referencing this source from SQL
  const regex = new RegExp(
    `\\s*(?:INNER|LEFT|RIGHT|FULL)?\\s*JOIN\\s+${args.rightRefId}\\s+ON\\s+[^\\s]+\\s*=\\s*[^\\s]+`,
    "gi",
  );
  const sql = current?.sql_definition ?? "";
  const newSql = sql.replace(regex, "");
  await patchReport(context.queryClient, context.reportId, {
    source_refs: newSourceRefs,
    sql_definition: newSql,
  });
  return `Removed join to "${args.rightRefId}"`;
}

// ============================================================================
// Intelligence Handler
// ============================================================================

export async function handleSuggestStructure(
  args: { sourceColumns: Array<{ name: string; type: string }> },
): Promise<string> {
  const suggestions: string[] = [];

  for (const col of args.sourceColumns) {
    const name = col.name.toLowerCase();
    const type = col.type.toLowerCase();

    if (name.endsWith("_id")) {
      suggestions.push(`- **${col.name}**: entity (foreign key)`);
    } else if (name.endsWith("_at") || name.endsWith("_date") || name.endsWith("_timestamp") || type.includes("date") || type.includes("time")) {
      suggestions.push(`- **${col.name}**: dimension (time)`);
    } else if (["int", "float", "decimal", "numeric", "number", "double", "bigint"].some((t) => type.includes(t))) {
      suggestions.push(`- **${col.name}**: measure (sum)`);
    } else {
      suggestions.push(`- **${col.name}**: dimension (categorical)`);
    }
  }

  return `Suggested structure:\n${suggestions.join("\n")}`;
}

// ============================================================================
// Dispatcher
// ============================================================================

/** Dispatches a report tool call to the appropriate handler. */
export async function executeReportToolCall(
  toolName: string,
  args: Record<string, unknown>,
  context: ReportToolContext,
): Promise<string> {
  switch (toolName) {
    case "createReport":
      return handleCreateReport(args as Parameters<typeof handleCreateReport>[0], context);
    case "renameReport":
      return handleRenameReport(args as Parameters<typeof handleRenameReport>[0], context);
    case "deleteReport":
      return handleDeleteReport(context);
    case "addDimension":
      return handleAddDimension(args as Parameters<typeof handleAddDimension>[0], context);
    case "removeDimension":
      return handleRemoveDimension(args as Parameters<typeof handleRemoveDimension>[0], context);
    case "addMeasure":
      return handleAddMeasure(args as Parameters<typeof handleAddMeasure>[0], context);
    case "removeMeasure":
      return handleRemoveMeasure(args as Parameters<typeof handleRemoveMeasure>[0], context);
    case "addFilter":
      return handleAddFilter(args as Parameters<typeof handleAddFilter>[0], context);
    case "removeFilter":
      return handleRemoveFilter(args as Parameters<typeof handleRemoveFilter>[0], context);
    case "addJoin":
      return handleAddJoin(args as Parameters<typeof handleAddJoin>[0], context);
    case "removeJoin":
      return handleRemoveJoin(args as Parameters<typeof handleRemoveJoin>[0], context);
    case "setMaterialization":
      return handleSetMaterialization(args as Parameters<typeof handleSetMaterialization>[0], context);
    case "setDomain":
      return handleSetDomain(args as Parameters<typeof handleSetDomain>[0], context);
    case "setReportType":
      return handleSetReportType(args as Parameters<typeof handleSetReportType>[0], context);
    case "suggestStructure":
      return handleSuggestStructure(args as Parameters<typeof handleSuggestStructure>[0]);
    default:
      return `Unknown report tool: ${toolName}`;
  }
}
