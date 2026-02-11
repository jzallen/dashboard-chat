import type { ToolCall } from "../types";
import type { TableRow, ToolCallHandlers } from "./types";

function performToolAction(
  toolCall: ToolCall,
  handlers: ToolCallHandlers
): void {
  const { name, arguments: argsJson } = toolCall.function;
  const args = JSON.parse(argsJson) as Record<string, unknown>;

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

function generateToolMessage(toolCall: ToolCall): string {
  const { name, arguments: argsJson } = toolCall.function;

  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argsJson);
  } catch {
    return `Error: Invalid arguments for ${name}`;
  }

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

    case "clearFilters":
      return "Cleared all filters";

    case "clearSort":
      return "Cleared sorting";

    default:
      return `Unknown tool: ${name}`;
  }
}

export function executeToolCall(
  toolCall: ToolCall,
  handlers: ToolCallHandlers
): string {
  const { name, arguments: argsJson } = toolCall.function;

  // Validate JSON first
  try {
    JSON.parse(argsJson);
  } catch {
    return `Error: Invalid arguments for ${name}`;
  }

  // Execute action
  performToolAction(toolCall, handlers);

  // Generate message
  return generateToolMessage(toolCall);
}
