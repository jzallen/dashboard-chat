import { CASE_OPERATIONS } from "@/chat/types";
import type { PreviewResponse } from "@/dataCatalog/datasets";

import { getErrorMessage } from "../errors";
import type { ToolCall } from "../types";
import { datasetKeys } from "../ui/hooks/useDatasetQuery";
import type {
  TableRow,
  ToolCallArgs,
  ToolCallContext,
  ToolCallHandlers,
} from "./types";

const validators: Record<
  string,
  (raw: Record<string, unknown>) => ToolCallArgs
> = {
  filterTable: (raw) => {
    if (typeof raw.column !== "string")
      throw new Error("filterTable: missing column");
    if (typeof raw.operator !== "string")
      throw new Error("filterTable: missing operator");
    if (raw.value === undefined) throw new Error("filterTable: missing value");
    return {
      tool: "filterTable",
      column: raw.column,
      operator: raw.operator,
      value: raw.value,
    };
  },
  sortTable: (raw) => {
    if (typeof raw.column !== "string")
      throw new Error("sortTable: missing column");
    if (raw.direction !== "asc" && raw.direction !== "desc")
      throw new Error("sortTable: invalid direction");
    return { tool: "sortTable", column: raw.column, direction: raw.direction };
  },
  addRow: (raw) => {
    if (typeof raw.data !== "object" || raw.data === null)
      throw new Error("addRow: missing data");
    return { tool: "addRow", data: raw.data as Record<string, unknown> };
  },
  deleteRow: (raw) => {
    if (typeof raw.search !== "string")
      throw new Error("deleteRow: missing search");
    return { tool: "deleteRow", search: raw.search };
  },
  replaceColumnFilter: (raw) => {
    if (typeof raw.column !== "string")
      throw new Error("replaceColumnFilter: missing column");
    return {
      tool: "replaceColumnFilter",
      column: raw.column,
      filters: raw.filters as Array<{ operator: string; value: unknown }>,
    };
  },
  generateFilter: (raw) => {
    if (typeof raw.description !== "string")
      throw new Error("generateFilter: missing description");
    if (!raw.raqb_tree) throw new Error("generateFilter: missing raqb_tree");
    return {
      tool: "generateFilter",
      description: raw.description,
      raqb_tree: raw.raqb_tree,
    };
  },
  clearFilters: () => ({ tool: "clearFilters" }),
  clearSort: () => ({ tool: "clearSort" }),
  trimWhitespace: (raw) => {
    if (typeof raw.column !== "string")
      throw new Error("trimWhitespace: missing column");
    return { tool: "trimWhitespace", column: raw.column };
  },
  standardizeCase: (raw) => {
    if (typeof raw.column !== "string")
      throw new Error("standardizeCase: missing column");
    if (typeof raw.mode !== "string")
      throw new Error("standardizeCase: missing mode");
    return { tool: "standardizeCase", column: raw.column, mode: raw.mode };
  },
  fillNulls: (raw) => {
    if (typeof raw.column !== "string")
      throw new Error("fillNulls: missing column");
    if (raw.fillValue === undefined)
      throw new Error("fillNulls: missing fillValue");
    return { tool: "fillNulls", column: raw.column, fillValue: raw.fillValue };
  },
  mapValues: (raw) => {
    if (typeof raw.column !== "string")
      throw new Error("mapValues: missing column");
    return {
      tool: "mapValues",
      column: raw.column,
      mappings: raw.mappings as Array<{ from: string; to: string }>,
    };
  },
  renameColumn: (raw) => {
    if (typeof raw.column !== "string")
      throw new Error("renameColumn: missing column");
    if (typeof raw.newName !== "string")
      throw new Error("renameColumn: missing newName");
    return { tool: "renameColumn", column: raw.column, newName: raw.newName };
  },
  applyCleaningTransform: (raw) => {
    if (typeof raw.column !== "string")
      throw new Error("applyCleaningTransform: missing column");
    if (typeof raw.operation !== "string")
      throw new Error("applyCleaningTransform: missing operation");
    return {
      tool: "applyCleaningTransform",
      column: raw.column,
      operation: raw.operation,
      config: (raw.config ?? {}) as Record<string, unknown>,
    };
  },
  undoCleaningTransform: (raw) => {
    if (raw.action !== "disable" && raw.action !== "delete")
      throw new Error("undoCleaningTransform: invalid action");
    return {
      tool: "undoCleaningTransform",
      action: raw.action,
      transformId: raw.transformId as string | undefined,
    };
  },
  reEnableCleaningTransform: (raw) => ({
    tool: "reEnableCleaningTransform",
    transformId: raw.transformId as string | undefined,
  }),
};

/** Validates raw tool call arguments against the validator map and returns a typed ToolCallArgs union member. */
function validateToolCallArgs(
  name: string,
  raw: Record<string, unknown>,
): ToolCallArgs {
  const validator = validators[name];
  if (!validator) throw new Error(`Unknown tool: ${name}`);
  return validator(raw);
}

/** Executes synchronous table actions (filter, sort, add/delete rows) against in-memory table state. */
function performTableAction(
  validated: ToolCallArgs,
  handlers: ToolCallHandlers,
): void {
  switch (validated.tool) {
    case "filterTable": {
      const { column, operator, value } = validated;
      handlers.setColumnFilters((prev) => {
        const existing = prev.find((f) => f.id === column);
        const newCondition = { operator, value };

        if (existing) {
          const val = existing.value as Record<string, unknown>;
          const conditions = val.conditions
            ? [
                ...(val.conditions as Array<Record<string, unknown>>),
                newCondition,
              ]
            : [
                {
                  operator: val.operator,
                  value: val.value,
                  transformId: val.transformId,
                },
                newCondition,
              ];
          return prev.map((f) =>
            f.id === column ? { ...f, value: { conditions } } : f,
          );
        }
        return [...prev, { id: column, value: newCondition }];
      });
      break;
    }

    case "sortTable": {
      const { column, direction } = validated;
      handlers.setSorting((prev) => {
        const filtered = prev.filter((s) => s.id !== column);
        return [...filtered, { id: column, desc: direction === "desc" }];
      });
      break;
    }

    case "addRow": {
      const newRow: TableRow = {
        id: String(Date.now()),
        ...validated.data,
      };
      handlers.setData((prev) => [...prev, newRow]);
      break;
    }

    case "deleteRow": {
      const searchLower = validated.search.toLowerCase();
      handlers.setData((prev) => {
        const indexToDelete = prev.findIndex((row) =>
          Object.values(row).some((value) =>
            String(value).toLowerCase().includes(searchLower),
          ),
        );
        if (indexToDelete === -1) return prev;
        return prev.filter((_, i) => i !== indexToDelete);
      });
      break;
    }

    case "replaceColumnFilter": {
      const { column, filters } = validated;
      handlers.setColumnFilters((prev) => {
        const withoutColumn = prev.filter((f) => f.id !== column);
        if (!filters || filters.length === 0) return withoutColumn;
        if (filters.length === 1)
          return [...withoutColumn, { id: column, value: filters[0] }];
        return [
          ...withoutColumn,
          { id: column, value: { conditions: filters } },
        ];
      });
      break;
    }

    case "generateFilter": {
      const filters = raqbTreeToFilters(validated.raqb_tree as RaqbGroup);
      handlers.setColumnFilters(filters);
      break;
    }

    case "clearFilters": {
      handlers.setColumnFilters([]);
      break;
    }

    case "clearSort": {
      handlers.setSorting([]);
      break;
    }

    default:
      break;
  }
}

// RAQB tree → column filters

interface RaqbRule {
  type: "rule";
  properties: {
    field: string;
    operator: string;
    value: unknown[];
  };
}

interface RaqbGroup {
  type: "group";
  properties: { conjunction: string };
  children1: Record<string, RaqbRule | RaqbGroup>;
}

function mapRaqbOperator(op: string): string {
  switch (op) {
    case "equal":
      return "equals";
    case "not_equal":
      return "notEquals";
    case "greater":
      return "gt";
    case "less":
      return "lt";
    case "greater_or_equal":
      return "gte";
    case "less_or_equal":
      return "lte";
    case "like":
      return "contains";
    default:
      return op;
  }
}

function raqbTreeToFilters(
  tree: RaqbGroup,
): Array<{ id: string; value: unknown }> {
  const filterMap = new Map<
    string,
    Array<{ operator: string; value: unknown }>
  >();

  for (const child of Object.values(tree.children1)) {
    if (child.type === "rule") {
      const field = child.properties.field;
      const op = mapRaqbOperator(child.properties.operator);
      const val = child.properties.value[0];
      if (!filterMap.has(field)) filterMap.set(field, []);
      filterMap.get(field)!.push({ operator: op, value: val });
    }
  }

  return Array.from(filterMap.entries()).map(([field, conditions]) =>
    conditions.length === 1
      ? { id: field, value: conditions[0] }
      : { id: field, value: { conditions } },
  );
}

function countRaqbRules(tree: RaqbGroup): number {
  let count = 0;
  for (const child of Object.values(tree.children1)) {
    if (child.type === "rule") count++;
    else if (child.type === "group") count += countRaqbRules(child);
  }
  return count;
}

/** Formats a cleaning transform preview into a human-readable summary with before/after samples. */
function formatPreviewResult(preview: PreviewResponse): string {
  let msg = `Preview: ${preview.operation_description}\n`;
  msg += `Affected: ${preview.affected_count} of ${preview.total_count} rows\n`;
  if (preview.samples.length > 0) {
    msg += "Samples:\n";
    for (const s of preview.samples) {
      const before = s.before === null ? "null" : `"${s.before}"`;
      const after = s.after === null ? "null" : `"${s.after}"`;
      msg += `  ${before} → ${after}\n`;
    }
  }
  return msg;
}

/** Handles async cleaning tool calls (preview, apply, undo) against the backend API. */
async function handleCleaningTool(
  validated: ToolCallArgs,
  context: ToolCallContext,
): Promise<string | null> {
  const { datasetId, transforms, queryClient, catalog } = context;

  switch (validated.tool) {
    case "trimWhitespace": {
      const preview = await catalog.previewCleaningTransform(datasetId, {
        transform_type: "clean",
        target_column: validated.column,
        expression_config: { operation: "trim" },
      });
      return formatPreviewResult(preview);
    }

    case "standardizeCase": {
      const preview = await catalog.previewCleaningTransform(datasetId, {
        transform_type: "clean",
        target_column: validated.column,
        expression_config: { operation: "case", mode: validated.mode },
      });
      return formatPreviewResult(preview);
    }

    case "fillNulls": {
      const preview = await catalog.previewCleaningTransform(datasetId, {
        transform_type: "clean",
        target_column: validated.column,
        expression_config: {
          operation: "fill_null",
          fill_value: validated.fillValue,
        },
      });
      return formatPreviewResult(preview);
    }

    case "mapValues": {
      const preview = await catalog.previewCleaningTransform(datasetId, {
        transform_type: "map",
        target_column: validated.column,
        expression_config: {
          operation: "map_values",
          mappings: validated.mappings,
        },
      });
      return formatPreviewResult(preview);
    }

    case "renameColumn": {
      await catalog.createCleaningTransforms(datasetId, [
        {
          name: `Rename ${validated.column} to ${validated.newName}`,
          transform_type: "alias",
          target_column: validated.column,
          expression_config: { operation: "alias", alias: validated.newName },
        },
      ]);
      queryClient.invalidateQueries({
        queryKey: datasetKeys.detail(datasetId),
        exact: true,
      });
      return `Renamed column: ${validated.column} → ${validated.newName}`;
    }

    case "applyCleaningTransform": {
      const { column, operation, config } = validated;
      const isCase = (CASE_OPERATIONS as readonly string[]).includes(operation);
      const expressionConfig = isCase
        ? { operation: "case", mode: operation, ...config }
        : { operation, ...config };
      const transformType = operation === "map_values" ? "map" : "clean";
      const transformName = `${operation} on ${column}`;
      await catalog.createCleaningTransforms(datasetId, [
        {
          name: transformName,
          transform_type: transformType,
          target_column: column,
          expression_config: expressionConfig,
        },
      ]);
      queryClient.invalidateQueries({
        queryKey: datasetKeys.detail(datasetId),
        exact: true,
      });
      return `Applied: ${transformName}`;
    }

    case "undoCleaningTransform": {
      let targetId = validated.transformId;
      if (!targetId) {
        const cleaningTransforms = transforms
          .filter(
            (t) => t.transform_type !== "filter" && t.status === "enabled",
          )
          .sort((a, b) =>
            (b.created_at ?? "").localeCompare(a.created_at ?? ""),
          );
        if (cleaningTransforms.length === 0) {
          return "No active cleaning transforms to undo.";
        }
        targetId = cleaningTransforms[0].id;
      }
      const newStatus = validated.action === "delete" ? "deleted" : "disabled";
      await catalog.updateTransform(datasetId, targetId, { status: newStatus });
      queryClient.invalidateQueries({
        queryKey: datasetKeys.detail(datasetId),
        exact: true,
      });
      const target = transforms.find((t) => t.id === targetId);
      const desc = target ? `${target.name}` : targetId;
      return `${validated.action === "delete" ? "Deleted" : "Disabled"} transform: ${desc}`;
    }

    case "reEnableCleaningTransform": {
      let targetId = validated.transformId;
      if (!targetId) {
        const disabledTransforms = transforms
          .filter(
            (t) => t.transform_type !== "filter" && t.status === "disabled",
          )
          .sort((a, b) =>
            (b.created_at ?? "").localeCompare(a.created_at ?? ""),
          );
        if (disabledTransforms.length === 0) {
          return "No disabled cleaning transforms to re-enable.";
        }
        targetId = disabledTransforms[0].id;
      }
      await catalog.updateTransform(datasetId, targetId, { status: "enabled" });
      queryClient.invalidateQueries({
        queryKey: datasetKeys.detail(datasetId),
        exact: true,
      });
      const target = transforms.find((t) => t.id === targetId);
      const desc = target ? `${target.name}` : targetId;
      return `Re-enabled transform: ${desc}`;
    }

    default:
      return null;
  }
}

const CLEANING_TOOLS = new Set([
  "trimWhitespace",
  "standardizeCase",
  "fillNulls",
  "mapValues",
  "renameColumn",
  "applyCleaningTransform",
  "undoCleaningTransform",
  "reEnableCleaningTransform",
]);

/** Generates a human-readable summary message for a completed tool call. */
function generateToolMessage(validated: ToolCallArgs): string {
  switch (validated.tool) {
    case "filterTable":
      return `Filtered ${validated.column} ${validated.operator} ${validated.value}`;
    case "sortTable":
      return `Sorted by ${validated.column} ${validated.direction}`;
    case "addRow":
      return "Added new row";
    case "deleteRow":
      return `Deleted row matching "${validated.search}"`;
    case "replaceColumnFilter": {
      const { column, filters } = validated;
      if (!filters?.length) return `Cleared filters on ${column}`;
      return `Replaced filter on ${column}: ${filters.map((f) => `${f.operator} ${f.value}`).join(" AND ")}`;
    }
    case "generateFilter": {
      const count = countRaqbRules(validated.raqb_tree as RaqbGroup);
      return `Applied filter: ${validated.description} (${count} condition${count !== 1 ? "s" : ""})`;
    }
    case "clearFilters":
      return "Cleared all filters";
    case "clearSort":
      return "Cleared sorting";
    case "trimWhitespace":
      return `Previewing trim whitespace on ${validated.column}...`;
    case "standardizeCase":
      return `Previewing ${validated.mode} case on ${validated.column}...`;
    case "fillNulls":
      return `Previewing fill nulls on ${validated.column}...`;
    case "mapValues":
      return `Previewing value mapping on ${validated.column}...`;
    case "renameColumn":
      return `Renaming ${validated.column} to ${validated.newName}...`;
    case "applyCleaningTransform":
      return `Applying ${validated.operation} on ${validated.column}...`;
    case "undoCleaningTransform":
      return "Undoing cleaning transform...";
    case "reEnableCleaningTransform":
      return "Re-enabling cleaning transform...";
  }
}

/**
 * Dispatches a validated tool call to the appropriate handler (table action or cleaning tool).
 * Parses and validates arguments, then returns a human-readable result message.
 */
export async function executeToolCall(
  toolCall: ToolCall,
  context: ToolCallContext,
): Promise<string> {
  const { name, arguments: argsJson } = toolCall.function;

  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argsJson);
  } catch {
    return `Error: Invalid arguments for ${name}`;
  }

  let validated: ToolCallArgs;
  try {
    validated = validateToolCallArgs(name, args);
  } catch (error) {
    return `Error: ${getErrorMessage(error)}`;
  }

  // Cleaning tools are async — handle them first
  if (CLEANING_TOOLS.has(name)) {
    try {
      const result = await handleCleaningTool(validated, context);
      return result ?? generateToolMessage(validated);
    } catch (error) {
      return `Error: ${getErrorMessage(error)}`;
    }
  }

  // Table tools are synchronous
  performTableAction(validated, context);
  return generateToolMessage(validated);
}
