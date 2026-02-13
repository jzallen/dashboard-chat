import type { ToolCall } from "../types";
import type { TableRow, ToolCallHandlers } from "./types";

function performToolAction(
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

    default:
      return `Unknown tool: ${name}`;
  }
}

export function executeToolCall(
  toolCall: ToolCall,
  handlers: ToolCallHandlers
): string {
  const { name, arguments: argsJson } = toolCall.function;

  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argsJson);
  } catch {
    return `Error: Invalid arguments for ${name}`;
  }

  performToolAction(name, args, handlers);
  return generateToolMessage(name, args);
}
