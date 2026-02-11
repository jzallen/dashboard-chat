import { useState, useMemo, useEffect, useRef } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
} from "@tanstack/react-table";
import { customFilterFn, type TableRow } from "@/table-tools";
import type { Dataset, SchemaConfig } from "@/api";

interface UseTableConfigOptions {
  dataset?: Dataset | null;
}

function buildColumnsFromSchema(schema: SchemaConfig): ColumnDef<TableRow>[] {
  return Object.entries(schema.fields).map(([key, config]) => ({
    accessorKey: key,
    header: config.label || key,
  }));
}

export function useTableConfig(options: UseTableConfigOptions = {}) {
  const { dataset } = options;

  const [data, setData] = useState<TableRow[]>([]);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  const columns = useMemo<ColumnDef<TableRow>[]>(() => {
    if (dataset?.schema_config) {
      return buildColumnsFromSchema(dataset.schema_config);
    }
    return [];
  }, [dataset?.schema_config]);

  // Sync preview_rows into data state when dataset changes
  const lastDatasetId = useRef<string | undefined>();
  useEffect(() => {
    if (dataset && dataset.id !== lastDatasetId.current) {
      lastDatasetId.current = dataset.id;
      if (dataset.preview_rows?.length) {
        setData(dataset.preview_rows as TableRow[]);
      }
    }
  }, [dataset]);

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
