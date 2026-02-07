import { useState, useMemo } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  SortingState,
  ColumnFiltersState,
} from "@tanstack/react-table";
import { customFilterFn, type TableRow } from "@/table-tools";
import { initialData, columns as sampleColumns } from "../data/sampleData";

interface UseTableConfigOptions {
  /** Dataset ID for server-side filtering (currently unused, for future implementation) */
  datasetId?: string;
}

export function useTableConfig(options: UseTableConfigOptions = {}) {
  const [data, setData] = useState<TableRow[]>(initialData);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  const columns = useMemo(() => sampleColumns, []);

  const reactTable = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    filterFns: { custom: customFilterFn },
    defaultColumn: { filterFn: customFilterFn },
  });

  // Refresh function for compatibility (no-op since we use local data)
  const refresh = () => Promise.resolve(data);

  return {
    table: reactTable,
    data,
    setData,
    sorting,
    setSorting,
    columnFilters,
    setColumnFilters,
    loading: false,
    error: null,
    refresh,
  };
}
