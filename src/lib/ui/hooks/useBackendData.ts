/**
 * Hook for fetching data from the backend DuckDB API.
 *
 * Provides data loading from the FastAPI backend with DuckDB support.
 */

import { useState, useEffect, useCallback } from "react";
import { get } from "@/api/client";
import type { TableRow } from "@/table-tools";

/**
 * Backend query response format
 */
interface QueryResponse {
  rows: Array<Record<string, unknown>>;
  columns: string[];
  total_count: number;
  limit: number;
  offset: number;
}

/**
 * Backend table list response
 */
interface TableListResponse {
  database: string;
  tables: string[];
}

/**
 * Hook options
 */
interface UseBackendDataOptions {
  /** DuckDB file name (default: sample.duckdb) */
  dbFile?: string;
  /** Table to query (uses first table if not specified) */
  table?: string;
  /** Dataset ID to apply enabled transforms */
  datasetId?: string;
  /** Number of rows to fetch */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Whether to fetch data on mount */
  autoFetch?: boolean;
}

/**
 * Hook for fetching data from the backend
 */
export function useBackendData(options: UseBackendDataOptions = {}) {
  const {
    dbFile = "sample.duckdb",
    table,
    datasetId,
    limit = 1000,
    offset = 0,
    autoFetch = true,
  } = options;

  const [data, setData] = useState<TableRow[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [tables, setTables] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  /**
   * Fetch available tables
   */
  const fetchTables = useCallback(async () => {
    try {
      const response = await get<TableListResponse>(
        `/api/data/tables?db_file=${encodeURIComponent(dbFile)}`
      );
      setTables(response.tables);
      return response.tables;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      return [];
    }
  }, [dbFile]);

  /**
   * Fetch data from the backend
   */
  const fetchData = useCallback(
    async (tableName?: string) => {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          db_file: dbFile,
          limit: String(limit),
          offset: String(offset),
        });

        if (tableName || table) {
          params.set("table", tableName || table || "");
        }

        if (datasetId) {
          params.set("dataset_id", datasetId);
        }

        const response = await get<QueryResponse>(
          `/api/data/query?${params.toString()}`
        );

        // Transform rows to TableRow format (ensure id is string)
        const transformedRows: TableRow[] = response.rows.map((row, index) => ({
          ...row,
          id: String(row.id ?? index),
        })) as TableRow[];

        setData(transformedRows);
        setColumns(response.columns);
        setTotalCount(response.total_count);

        return transformedRows;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        return [];
      } finally {
        setLoading(false);
      }
    },
    [dbFile, table, datasetId, limit, offset]
  );

  /**
   * Refresh data
   */
  const refresh = useCallback(() => {
    return fetchData(table);
  }, [fetchData, table]);

  // Auto-fetch on mount
  // When datasetId is provided, we defer the initial fetch to allow
  // pipeline filters to be loaded first (to avoid double-fetch)
  useEffect(() => {
    if (autoFetch && !datasetId) {
      fetchData();
    }
  }, [autoFetch, fetchData, datasetId]);

  return {
    data,
    setData,
    columns,
    totalCount,
    tables,
    loading,
    error,
    fetchData,
    fetchTables,
    refresh,
  };
}
