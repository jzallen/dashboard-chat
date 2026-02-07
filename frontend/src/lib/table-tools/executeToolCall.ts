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
        const filtered = prev.filter((f) => f.id !== column);
        return [...filtered, { id: column, value: { operator, value } }];
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
      const { data: rowData } = args as { data: Partial<TableRow> };
      const newRow: TableRow = {
        id: String(Date.now()),
        name: "",
        category: "",
        amount: 0,
        quantity: 0,
        inStock: true,
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
