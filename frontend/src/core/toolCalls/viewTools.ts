import type { QueryClient } from "@tanstack/react-query";

import { withAuth } from "@/auth";
import {
  createDataCatalog,
  type View,
  type ViewColumn,
  type ViewCreate,
  type ViewUpdate,
} from "@/dataCatalog";

import { viewKeys } from "../../lib/queryKeys";

const catalog = createDataCatalog(withAuth(fetch));

export interface ViewToolContext {
  viewId: string;
  projectId: string;
  queryClient: QueryClient;
  navigate: (path: string) => void;
  setContext: (type: "view" | "dataset" | null, id: string | null) => void;
}

/** Read-modify-write helper: reads current view from cache, applies updater, patches via API. */
async function patchView(
  queryClient: QueryClient,
  viewId: string,
  patch: ViewUpdate,
): Promise<string> {
  await catalog.updateView(viewId, patch);
  queryClient.invalidateQueries({ queryKey: viewKeys.detail(viewId), exact: true });
  return "Done";
}

/** Read columns from cache, apply updater, and PATCH. */
async function patchColumns(
  queryClient: QueryClient,
  viewId: string,
  updater: (cols: ViewColumn[]) => ViewColumn[],
): Promise<string> {
  const current = queryClient.getQueryData<View>(viewKeys.detail(viewId));
  const newCols = updater(current?.columns ?? []);
  return patchView(queryClient, viewId, { columns: newCols });
}

export async function handleCreateView(
  args: { name: string; description?: string; sourceRefs?: Array<{ id: string; type: "dataset" | "view" }> },
  context: ViewToolContext,
): Promise<string> {
  const data: ViewCreate = {
    name: args.name,
    description: args.description,
    source_refs: args.sourceRefs,
  };
  const view = await catalog.createView(context.projectId, data);
  context.queryClient.invalidateQueries({ queryKey: viewKeys.list(context.projectId) });
  context.setContext("view", view.id);
  context.navigate(`/view/${view.id}`);
  return `Created view "${view.name}"`;
}

export async function handleRenameView(
  args: { name: string },
  context: ViewToolContext,
): Promise<string> {
  await patchView(context.queryClient, context.viewId, { name: args.name });
  return `Renamed view to "${args.name}"`;
}

export async function handleSetMaterialization(
  args: { strategy: "ephemeral" | "view" | "table" | "incremental" },
  context: ViewToolContext,
): Promise<string> {
  await patchView(context.queryClient, context.viewId, { materialization: args.strategy });
  return `Materialization set to "${args.strategy}"`;
}

export async function handleAddColumn(
  args: { sourceRef: string; sourceColumn: string; displayType: string; alias?: string },
  context: ViewToolContext,
): Promise<string> {
  const newCol: ViewColumn = {
    name: args.alias ?? args.sourceColumn,
    source_ref: args.sourceRef,
    source_column: args.sourceColumn,
    display_type: args.displayType as ViewColumn["display_type"],
    grain_role: null,
    alias: args.alias ?? null,
  };
  await patchColumns(context.queryClient, context.viewId, (cols) => [...cols, newCol]);
  return `Added column "${newCol.name}"`;
}

export async function handleRemoveColumn(
  args: { columnName: string },
  context: ViewToolContext,
): Promise<string> {
  await patchColumns(context.queryClient, context.viewId, (cols) =>
    cols.filter((c) => c.name !== args.columnName),
  );
  return `Removed column "${args.columnName}"`;
}

export async function handleCastColumn(
  args: { columnName: string; displayType: string },
  context: ViewToolContext,
): Promise<string> {
  await patchColumns(context.queryClient, context.viewId, (cols) =>
    cols.map((c) =>
      c.name === args.columnName
        ? { ...c, display_type: args.displayType as ViewColumn["display_type"] }
        : c,
    ),
  );
  return `Cast "${args.columnName}" to ${args.displayType}`;
}

export async function handleAddJoin(
  args: { rightRef: string; leftColumn: string; rightColumn: string; joinType?: string },
  context: ViewToolContext,
): Promise<string> {
  const current = context.queryClient.getQueryData<View>(viewKeys.detail(context.viewId));
  const leftRef = current?.source_refs[0]?.id ?? "";
  const newJoin = {
    left_ref: leftRef,
    left_column: args.leftColumn,
    right_ref: args.rightRef,
    right_column: args.rightColumn,
    join_type: args.joinType ?? "INNER",
  };
  await patchView(context.queryClient, context.viewId, {
    joins: [...(current?.joins ?? []), newJoin],
  });
  return `Added ${newJoin.join_type} join to "${args.rightRef}"`;
}

export async function handleRemoveJoin(
  args: { rightRef: string },
  context: ViewToolContext,
): Promise<string> {
  const current = context.queryClient.getQueryData<View>(viewKeys.detail(context.viewId));
  await patchView(context.queryClient, context.viewId, {
    joins: (current?.joins ?? []).filter((j) => j.right_ref !== args.rightRef),
  });
  return `Removed join to "${args.rightRef}"`;
}

export async function handleAddFilter(
  args: { sourceRef: string; column: string; operator: string; value?: string },
  context: ViewToolContext,
): Promise<string> {
  const current = context.queryClient.getQueryData<View>(viewKeys.detail(context.viewId));
  const newFilter = {
    source_ref: args.sourceRef,
    column: args.column,
    operator: args.operator,
    value: args.value ?? null,
  };
  await patchView(context.queryClient, context.viewId, {
    filters: [...(current?.filters ?? []), newFilter],
  });
  return `Added filter on "${args.column}"`;
}

export async function handleRemoveFilter(
  args: { column: string },
  context: ViewToolContext,
): Promise<string> {
  const current = context.queryClient.getQueryData<View>(viewKeys.detail(context.viewId));
  await patchView(context.queryClient, context.viewId, {
    filters: (current?.filters ?? []).filter((f) => f.column !== args.column),
  });
  return `Removed filter on "${args.column}"`;
}

export async function handleSetGrain(
  args: { timeColumn: string; dimensions?: string[] },
  context: ViewToolContext,
): Promise<string> {
  await patchView(context.queryClient, context.viewId, {
    grain: { time_column: args.timeColumn, dimensions: args.dimensions ?? [] },
  });
  return `Grain set: time=${args.timeColumn}, dimensions=${args.dimensions?.join(", ") ?? "none"}`;
}

export async function handleDeleteView(
  context: ViewToolContext,
): Promise<string> {
  const current = context.queryClient.getQueryData<View>(viewKeys.detail(context.viewId));
  const name = current?.name ?? context.viewId;
  await catalog.deleteView(context.viewId);
  context.queryClient.invalidateQueries({ queryKey: viewKeys.list(context.projectId) });
  context.setContext(null, null);
  context.navigate("/");
  return `Deleted view "${name}"`;
}

/** Dispatches a view tool call to the appropriate handler. */
export async function executeViewToolCall(
  toolName: string,
  args: Record<string, unknown>,
  context: ViewToolContext,
): Promise<string> {
  switch (toolName) {
    case "createView":
      return handleCreateView(args as Parameters<typeof handleCreateView>[0], context);
    case "renameView":
      return handleRenameView(args as Parameters<typeof handleRenameView>[0], context);
    case "setMaterialization":
      return handleSetMaterialization(args as Parameters<typeof handleSetMaterialization>[0], context);
    case "addColumn":
      return handleAddColumn(args as Parameters<typeof handleAddColumn>[0], context);
    case "removeColumn":
      return handleRemoveColumn(args as Parameters<typeof handleRemoveColumn>[0], context);
    case "castColumn":
      return handleCastColumn(args as Parameters<typeof handleCastColumn>[0], context);
    case "addJoin":
      return handleAddJoin(args as Parameters<typeof handleAddJoin>[0], context);
    case "removeJoin":
      return handleRemoveJoin(args as Parameters<typeof handleRemoveJoin>[0], context);
    case "addFilter":
      return handleAddFilter(args as Parameters<typeof handleAddFilter>[0], context);
    case "removeFilter":
      return handleRemoveFilter(args as Parameters<typeof handleRemoveFilter>[0], context);
    case "setGrain":
      return handleSetGrain(args as Parameters<typeof handleSetGrain>[0], context);
    case "deleteView":
      return handleDeleteView(context);
    default:
      return `Unknown view tool: ${toolName}`;
  }
}
