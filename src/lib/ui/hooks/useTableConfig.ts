import { useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  SortingState,
  ColumnFiltersState,
} from "@tanstack/react-table";
import { customFilterFn, type TableRow } from "../../table-tools";
import { initialData, columns } from "../data/sampleData";

export function useTableConfig() {
  const [data, setData] = useState<TableRow[]>(initialData);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  const table = useReactTable({
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
    table,
    data,
    setData,
    sorting,
    setSorting,
    columnFilters,
    setColumnFilters,
  };
}
