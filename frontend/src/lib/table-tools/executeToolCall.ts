import type { ToolCall } from "../types";
import type { TableRow, ToolCallContext, ToolCallHandlers } from "./types";
import {
  previewCleaningTransform,
  createCleaningTransforms,
  updateTransform,
  type PreviewResponse,
} from "@/api/datasets";
import { datasetKeys } from "../ui/hooks/useDatasetQuery";

// --- Table tool actions (synchronous) ---

function performTableAction(
  name: string,
  args: Record<string, unknown>,
  handlers: ToolCallHandlers
): void {

  switch (name) {
    case "filterTable": {
      const { column, operator, value } = args as {
        column: string;
        operator: string;
        value: unknown;
      };
      handlers.setColumnFilters((prev) => {
        const existing = prev.find((f) => f.id === column);
        const newCondition = { operator, value };

        if (existing) {
          // Merge into compound filter (AND logic)
          const val = existing.value as Record<string, unknown>;
          const conditions = val.conditions
            ? [...(val.conditions as Array<Record<string, unknown>>), newCondition]
            : [{ operator: val.operator, value: val.value, transformId: val.transformId }, newCondition];
          return prev.map((f) =>
            f.id === column ? { ...f, value: { conditions } } : f
          );
        }
        return [...prev, { id: column, value: newCondition }];
      });
      break;
    }

    case "sortTable": {
      const { column, direction } = args as {
        column: string;
        direction: "asc" | "desc";
      };
      handlers.setSorting((prev) => {
        const filtered = prev.filter((s) => s.id !== column);
        return [...filtered, { id: column, desc: direction === "desc" }];
      });
      break;
    }

    case "addRow": {
      const { data: rowData } = args as { data: Record<string, unknown> };
      const newRow: TableRow = {
        id: String(Date.now()),
        ...rowData,
      };
      handlers.setData((prev) => [...prev, newRow]);
      break;
    }

    case "deleteRow": {
      const { search } = args as { search: string };
      const searchLower = search.toLowerCase();
      handlers.setData((prev) => {
        const indexToDelete = prev.findIndex((row) =>
          Object.values(row).some((value) =>
            String(value).toLowerCase().includes(searchLower)
          )
        );
        if (indexToDelete === -1) return prev;
        return prev.filter((_, i) => i !== indexToDelete);
      });
      break;
    }

    case "replaceColumnFilter": {
      const { column, filters } = args as {
        column: string;
        filters: Array<{ operator: string; value: unknown }>;
      };
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
      const { raqb_tree } = args as { description: string; raqb_tree: RaqbGroup };
      const filters = raqbTreeToFilters(raqb_tree);
      // Replace all existing filters
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

// --- RAQB tree → column filters ---

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
    case "equal": return "equals";
    case "not_equal": return "notEquals";
    case "greater": return "gt";
    case "less": return "lt";
    case "greater_or_equal": return "gte";
    case "less_or_equal": return "lte";
    case "like": return "contains";
    default: return op;
  }
}

function raqbTreeToFilters(
  tree: RaqbGroup
): Array<{ id: string; value: unknown }> {
  const filterMap = new Map<string, Array<{ operator: string; value: unknown }>>();

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
      : { id: field, value: { conditions } }
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

// --- Cleaning tool handlers (async) ---

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

async function handleCleaningTool(
  name: string,
  args: Record<string, unknown>,
  context: ToolCallContext
): Promise<string | null> {
  const { datasetId, transforms, queryClient } = context;

  switch (name) {
    case "trimWhitespace": {
      const { column } = args as { column: string };
      const preview = await previewCleaningTransform(datasetId, {
        transform_type: "clean",
        target_column: column,
        expression_config: { operation: "trim" },
      });
      return formatPreviewResult(preview);
    }

    case "standardizeCase": {
      const { column, mode } = args as { column: string; mode: string };
      const preview = await previewCleaningTransform(datasetId, {
        transform_type: "clean",
        target_column: column,
        expression_config: { operation: "case", mode },
      });
      return formatPreviewResult(preview);
    }

    case "fillNulls": {
      const { column, fillValue } = args as { column: string; fillValue: unknown };
      const preview = await previewCleaningTransform(datasetId, {
        transform_type: "clean",
        target_column: column,
        expression_config: { operation: "fill_null", fill_value: fillValue },
      });
      return formatPreviewResult(preview);
    }

    case "mapValues": {
      const { column, mappings } = args as {
        column: string;
        mappings: Array<{ from: string; to: string }>;
      };
      const preview = await previewCleaningTransform(datasetId, {
        transform_type: "map",
        target_column: column,
        expression_config: { operation: "map_values", mappings },
      });
      return formatPreviewResult(preview);
    }

    case "renameColumn": {
      const { column, newName } = args as { column: string; newName: string };
      await createCleaningTransforms(datasetId, [
        {
          name: `Rename ${column} to ${newName}`,
          transform_type: "alias",
          target_column: column,
          expression_config: { operation: "alias", alias: newName },
        },
      ]);
      queryClient.invalidateQueries({ queryKey: datasetKeys.detail(datasetId) });
      return `Renamed column: ${column} → ${newName}`;
    }

    case "applyCleaningTransform": {
      const { column, operation, config } = args as {
        column: string;
        operation: string;
        config: Record<string, unknown>;
      };
      // Map tool-level operation to backend expression_config format
      const isCase = ["upper", "lower", "title"].includes(operation);
      const expressionConfig = isCase
        ? { operation: "case", mode: operation, ...config }
        : { operation, ...config };
      const transformType = operation === "map_values" ? "map" : "clean";
      const transformName = `${operation} on ${column}`;
      await createCleaningTransforms(datasetId, [
        {
          name: transformName,
          transform_type: transformType,
          target_column: column,
          expression_config: expressionConfig,
        },
      ]);
      queryClient.invalidateQueries({ queryKey: datasetKeys.detail(datasetId) });
      return `Applied: ${transformName}`;
    }

    case "undoCleaningTransform": {
      const { action, transformId } = args as {
        action: "disable" | "delete";
        transformId?: string;
      };
      // Find the target transform
      let targetId = transformId;
      if (!targetId) {
        // Find most recent active cleaning transform
        const cleaningTransforms = transforms
          .filter(
            (t) =>
              t.transform_type !== "filter" &&
              t.status === "enabled"
          )
          .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
        if (cleaningTransforms.length === 0) {
          return "No active cleaning transforms to undo.";
        }
        targetId = cleaningTransforms[0].id;
      }
      const newStatus = action === "delete" ? "deleted" : "disabled";
      await updateTransform(datasetId, targetId, { status: newStatus });
      queryClient.invalidateQueries({ queryKey: datasetKeys.detail(datasetId) });
      const target = transforms.find((t) => t.id === targetId);
      const desc = target ? `${target.name}` : targetId;
      return `${action === "delete" ? "Deleted" : "Disabled"} transform: ${desc}`;
    }

    case "reEnableCleaningTransform": {
      const { transformId } = args as { transformId?: string };
      let targetId = transformId;
      if (!targetId) {
        // Find most recently disabled cleaning transform
        const disabledTransforms = transforms
          .filter(
            (t) =>
              t.transform_type !== "filter" &&
              t.status === "disabled"
          )
          .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
        if (disabledTransforms.length === 0) {
          return "No disabled cleaning transforms to re-enable.";
        }
        targetId = disabledTransforms[0].id;
      }
      await updateTransform(datasetId, targetId, { status: "enabled" });
      queryClient.invalidateQueries({ queryKey: datasetKeys.detail(datasetId) });
      const target = transforms.find((t) => t.id === targetId);
      const desc = target ? `${target.name}` : targetId;
      return `Re-enabled transform: ${desc}`;
    }

    default:
      return null;
  }
}

// --- Cleaning tool names set ---

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

// --- Message generation ---

function generateToolMessage(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "filterTable": {
      const { column, operator, value } = args as {
        column: string;
        operator: string;
        value: unknown;
      };
      return `Filtered ${column} ${operator} ${value}`;
    }

    case "sortTable": {
      const { column, direction } = args as {
        column: string;
        direction: "asc" | "desc";
      };
      return `Sorted by ${column} ${direction}`;
    }

    case "addRow":
      return "Added new row";

    case "deleteRow": {
      const { search } = args as { search: string };
      return `Deleted row matching "${search}"`;
    }

    case "replaceColumnFilter": {
      const { column, filters } = args as {
        column: string;
        filters?: Array<{ operator: string; value: unknown }>;
      };
      if (!filters?.length) return `Cleared filters on ${column}`;
      return `Replaced filter on ${column}: ${filters.map((f) => `${f.operator} ${f.value}`).join(" AND ")}`;
    }

    case "generateFilter": {
      const { description, raqb_tree } = args as { description: string; raqb_tree: RaqbGroup };
      const count = countRaqbRules(raqb_tree);
      return `Applied filter: ${description} (${count} condition${count !== 1 ? "s" : ""})`;
    }

    case "clearFilters":
      return "Cleared all filters";

    case "clearSort":
      return "Cleared sorting";

    // Cleaning tools — messages come from the async handler
    case "trimWhitespace": {
      const { column } = args as { column: string };
      return `Previewing trim whitespace on ${column}...`;
    }
    case "standardizeCase": {
      const { column, mode } = args as { column: string; mode: string };
      return `Previewing ${mode} case on ${column}...`;
    }
    case "fillNulls": {
      const { column } = args as { column: string };
      return `Previewing fill nulls on ${column}...`;
    }
    case "mapValues": {
      const { column } = args as { column: string };
      return `Previewing value mapping on ${column}...`;
    }
    case "renameColumn": {
      const { column, newName } = args as { column: string; newName: string };
      return `Renaming ${column} to ${newName}...`;
    }
    case "applyCleaningTransform": {
      const { column, operation } = args as { column: string; operation: string };
      return `Applying ${operation} on ${column}...`;
    }
    case "undoCleaningTransform":
      return "Undoing cleaning transform...";
    case "reEnableCleaningTransform":
      return "Re-enabling cleaning transform...";

    default:
      return `Unknown tool: ${name}`;
  }
}

export async function executeToolCall(
  toolCall: ToolCall,
  context: ToolCallContext
): Promise<string> {
  const { name, arguments: argsJson } = toolCall.function;

  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argsJson);
  } catch {
    return `Error: Invalid arguments for ${name}`;
  }

  // Cleaning tools are async — handle them first
  if (CLEANING_TOOLS.has(name)) {
    try {
      const result = await handleCleaningTool(name, args, context);
      return result ?? generateToolMessage(name, args);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return `Error: ${message}`;
    }
  }

  // Table tools are synchronous
  performTableAction(name, args, context);
  return generateToolMessage(name, args);
}
