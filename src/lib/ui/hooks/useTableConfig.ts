import { useState, useEffect, useMemo } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  SortingState,
  ColumnFiltersState,
  ColumnDef,
} from "@tanstack/react-table";
import { customFilterFn, type TableRow } from "@/table-tools";
import { initialData, columns as sampleColumns } from "../data/sampleData";
import { useBackendData } from "./useBackendData";

/**
 * Generate dynamic columns from backend column names
 */
function generateColumns(columnNames: string[]): ColumnDef<TableRow>[] {
  return columnNames.map((name) => {
    const col: ColumnDef<TableRow> = {
      accessorKey: name,
      header: name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, " "),
    };

    // Add cell formatters based on column name patterns
    if (name === "amount" || name.includes("price") || name.includes("cost")) {
      col.cell = ({ getValue }) => {
        const val = getValue();
        if (typeof val === "number") return `$${val.toFixed(2)}`;
        if (typeof val === "string" && !isNaN(parseFloat(val))) {
          return `$${parseFloat(val).toFixed(2)}`;
        }
        return String(val ?? "");
      };
    } else if (name === "in_stock" || name.includes("bool")) {
      col.cell = ({ getValue }) => (getValue() ? "✓" : "✗");
    }

    return col;
  });
}

interface UseTableConfigOptions {
  /** Use backend API data (default: true) */
  useBackend?: boolean;
  /** DuckDB file name */
  dbFile?: string;
  /** Table name to query */
  table?: string;
}

export function useTableConfig(options: UseTableConfigOptions = {}) {
  const { useBackend = true, dbFile, table } = options;

  const {
    data: backendData,
    columns: backendColumns,
    loading,
    error,
    setData: setBackendData,
    refresh,
  } = useBackendData({
    dbFile,
    table,
    autoFetch: useBackend,
  });

  const [localData, setLocalData] = useState<TableRow[]>(initialData);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  // Use backend data if available, otherwise fall back to sample data
  const data = useBackend && backendData.length > 0 ? backendData : localData;
  const setData = useBackend ? setBackendData : setLocalData;

  // Generate columns dynamically from backend or use sample columns
  const columns = useMemo(() => {
    if (useBackend && backendColumns.length > 0) {
      return generateColumns(backendColumns);
    }
    return sampleColumns;
  }, [useBackend, backendColumns]);

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

  return {
    table: reactTable,
    data,
    setData,
    sorting,
    setSorting,
    columnFilters,
    setColumnFilters,
    // Backend-specific
    loading,
    error,
    refresh,
    isUsingBackend: useBackend && backendData.length > 0,
  };
}
