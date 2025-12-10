import type { ColumnFiltersState, SortingState } from "@tanstack/react-table";

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
