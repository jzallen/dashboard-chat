import type { ColumnFiltersState, SortingState } from "@tanstack/react-table";
import type { QueryClient } from "@tanstack/react-query";

export type TableRow = Record<string, unknown>;

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
