import type { QueryClient } from "@tanstack/react-query";
import type { ColumnFiltersState, SortingState } from "@tanstack/react-table";

export type TableRow = Record<string, unknown>;

export type ToolCallArgs =
  | { tool: "filterTable"; column: string; operator: string; value: unknown }
  | { tool: "sortTable"; column: string; direction: "asc" | "desc" }
  | { tool: "addRow"; data: Record<string, unknown> }
  | { tool: "deleteRow"; search: string }
  | { tool: "replaceColumnFilter"; column: string; filters: Array<{ operator: string; value: unknown }> }
  | { tool: "generateFilter"; description: string; raqb_tree: unknown }
  | { tool: "clearFilters" }
  | { tool: "clearSort" }
  | { tool: "trimWhitespace"; column: string }
  | { tool: "standardizeCase"; column: string; mode: string }
  | { tool: "fillNulls"; column: string; fillValue: unknown }
  | { tool: "mapValues"; column: string; mappings: Array<{ from: string; to: string }> }
  | { tool: "renameColumn"; column: string; newName: string }
  | { tool: "applyCleaningTransform"; column: string; operation: string; config: Record<string, unknown> }
  | { tool: "undoCleaningTransform"; action: "disable" | "delete"; transformId?: string }
  | { tool: "reEnableCleaningTransform"; transformId?: string };

export interface ToolCallHandlers {
  setColumnFilters: (
    updater: ColumnFiltersState | ((prev: ColumnFiltersState) => ColumnFiltersState)
  ) => void;
  setSorting: (
    updater: SortingState | ((prev: SortingState) => SortingState)
  ) => void;
  setData: (updater: (prev: TableRow[]) => TableRow[]) => void;
}

export interface TransformInfo {
  id: string;
  name: string;
  status: string;
  transform_type: string;
  target_column?: string | null;
  expression_config?: Record<string, unknown> | null;
  created_at?: string;
}

export interface ToolCallContext extends ToolCallHandlers {
  datasetId: string;
  transforms: TransformInfo[];
  queryClient: QueryClient;
}
