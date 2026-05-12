import type { QueryClient } from "@tanstack/react-query";
import type { ColumnFiltersState, SortingState } from "@tanstack/react-table";

import type { DataCatalog } from "@/dataCatalog";

/** A single row of table data, keyed by column name. */
export type TableRow = Record<string, unknown>;

/** Discriminated union of all validated tool call argument shapes. The `tool` field is the discriminant.
 *  After PR 1 (cleaning) and PR 2 (mutations) of worker-tool-dispatch-refactor,
 *  only the UI-directive family remains here (PR 3 migrates and deletes it). */
export type ToolCallArgs =
  | { tool: "filterTable"; column: string; operator: string; value: unknown }
  | { tool: "sortTable"; column: string; direction: "asc" | "desc" }
  | {
      tool: "replaceColumnFilter";
      column: string;
      filters: Array<{ operator: string; value: unknown }>;
    }
  | { tool: "generateFilter"; description: string; raqb_tree: unknown }
  | { tool: "clearFilters" }
  | { tool: "clearSort" };

/** Callbacks for mutating table state (filters, sorting, data) in response to tool calls. */
export interface ToolCallHandlers {
  setColumnFilters: (
    updater:
      | ColumnFiltersState
      | ((prev: ColumnFiltersState) => ColumnFiltersState),
  ) => void;
  setSorting: (
    updater: SortingState | ((prev: SortingState) => SortingState),
  ) => void;
  setData: (updater: (prev: TableRow[]) => TableRow[]) => void;
}

/** Minimal transform metadata passed to tool call handlers for undo/re-enable operations. */
export interface TransformInfo {
  id: string;
  name: string;
  status: string;
  transform_type: string;
  target_column?: string | null;
  expression_config?: Record<string, unknown> | null;
  created_at?: string;
}

/** Full context needed to execute a tool call, combining table handlers with dataset info. */
export interface ToolCallContext extends ToolCallHandlers {
  datasetId: string;
  transforms: TransformInfo[];
  queryClient: QueryClient;
  catalog: DataCatalog;
}
