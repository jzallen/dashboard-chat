import {
  type ColumnDef,
  type ColumnFiltersState,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import { useEffect,useMemo, useState } from "react";

import type { Dataset, SchemaConfig } from "@/dataCatalog";
import { customFilterFn, type TableRow } from "@/toolCalls";

/** Options for configuring the table instance. */
interface UseTableConfigOptions {
  /** The dataset whose schema and preview rows drive the table. Null while loading. */
  dataset?: Dataset | null;
}

function buildColumnsFromSchema(
  schema: SchemaConfig,
  aliasMap?: Map<string, string>
): ColumnDef<TableRow>[] {
  return Object.entries(schema.fields).map(([key, config]) => ({
    accessorKey: key,
    header: aliasMap?.get(key) ?? config.label ?? key,
  }));
}

/**
 * Configures a TanStack Table instance from a dataset's schema and preview rows.
 * Handles column generation (with alias support), sorting, filtering, and pagination.
 */
export function useTableConfig(options: UseTableConfigOptions = {}) {
  const { dataset } = options;

  const [data, setData] = useState<TableRow[]>([]);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  // Build alias map from active alias transforms
  const aliasMap = useMemo(() => {
    const map = new Map<string, string>();
    if (dataset?.transforms) {
      for (const t of dataset.transforms) {
        if (
          t.status === "enabled" &&
          t.transform_type === "alias" &&
          t.target_column &&
          t.expression_config
        ) {
          const config = t.expression_config;
          if (config && config.operation === "alias") {
            if (config.alias) map.set(t.target_column, config.alias);
          }
        }
      }
    }
    return map;
  }, [dataset?.transforms]);

  const columns = useMemo<ColumnDef<TableRow>[]>(() => {
    if (dataset?.schema_config) {
      return buildColumnsFromSchema(dataset.schema_config, aliasMap);
    }
    return [];
  }, [dataset?.schema_config, aliasMap]);

  // Sync preview_rows into data state when dataset or its rows change
  useEffect(() => {
    if (dataset?.preview_rows) {
      setData(dataset.preview_rows as TableRow[]);
    }
  }, [dataset?.preview_rows]);

  const reactTable = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters, columnVisibility },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
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
    columnVisibility,
    setColumnVisibility,
    refresh,
  };
}
