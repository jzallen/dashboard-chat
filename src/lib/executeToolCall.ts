// Extracted tool execution logic for testability
// Pure function with no React dependencies

import type { ColumnFiltersState, SortingState } from "@tanstack/react-table";

// ============================================================================
// Types
// ============================================================================

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface TableRow {
  id: string;
  name: string;
  category: string;
  amount: number;
  quantity: number;
  inStock: boolean;
}

export interface ToolCallHandlers {
  setColumnFilters: (
    updater: ColumnFiltersState | ((prev: ColumnFiltersState) => ColumnFiltersState)
  ) => void;
  setSorting: (sorting: SortingState) => void;
  setData: (updater: (prev: TableRow[]) => TableRow[]) => void;
}

// ============================================================================
// Custom Filter Function
// ============================================================================

export function customFilterFn(
  row: { getValue: (columnId: string) => unknown },
  columnId: string,
  filterValue: { operator: string; value: unknown }
): boolean {
  const cellValue = row.getValue(columnId);
  const { operator, value } = filterValue;

  switch (operator) {
    case "equals":
      return (
        cellValue === value ||
        String(cellValue).toLowerCase() === String(value).toLowerCase()
      );
    case "notEquals":
      return (
        cellValue !== value &&
        String(cellValue).toLowerCase() !== String(value).toLowerCase()
      );
    case "contains":
      return String(cellValue)
        .toLowerCase()
        .includes(String(value).toLowerCase());
    case "gt":
      return Number(cellValue) > Number(value);
    case "lt":
      return Number(cellValue) < Number(value);
    case "gte":
      return Number(cellValue) >= Number(value);
    case "lte":
      return Number(cellValue) <= Number(value);
    default:
      return true;
  }
}

// ============================================================================
// Tool Action Execution
// ============================================================================

export function performToolAction(
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
      handlers.setSorting([{ id: column, desc: direction === "desc" }]);
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
      const { rowIndex } = args as { rowIndex: number };
      handlers.setData((prev) => prev.filter((_, i) => i !== rowIndex));
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

// ============================================================================
// Tool Message Generation
// ============================================================================

export function generateToolMessage(toolCall: ToolCall): string {
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
      const { rowIndex } = args as { rowIndex: number };
      return `Deleted row at index ${rowIndex}`;
    }

    case "clearFilters":
      return "Cleared all filters";

    case "clearSort":
      return "Cleared sorting";

    default:
      return `Unknown tool: ${name}`;
  }
}

// ============================================================================
// Combined Tool Execution (Public API)
// ============================================================================

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
