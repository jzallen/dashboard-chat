import type { ColumnFiltersState, SortingState } from "@tanstack/react-table";

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
