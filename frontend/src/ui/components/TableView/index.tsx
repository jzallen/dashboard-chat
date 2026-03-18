import type { ColumnFiltersState, SortingState, VisibilityState } from "@tanstack/react-table";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";

/** Module-level cache for table state across navigations, keyed by datasetId. */
const tableStateCache = new Map<string, { columnFilters: ColumnFiltersState; sorting: SortingState; columnVisibility: VisibilityState }>();

import { withAuth } from "@/auth";
import { createDataCatalog } from "@/dataCatalog";

const catalog = createDataCatalog(withAuth(fetch));
import { raqbToSql } from "@/queryTranslation";
import {
  filterTableToRaqb,
  generateFilterDescription,
} from "@/queryTranslation/tanstackToRaqb";
import {
  executeToolCall as executeToolCallFn,
  type ToolCall,
  type ToolCallContext,
} from "@/toolCalls";

import { useChatContext } from "../../context/ChatContext";
import {
  getTransformIdsForColumn,
  toConditions,
} from "../../hooks/filterUtils";
import {
  datasetKeys,
  useDatasetQuery,
} from "../../hooks/useDatasetQuery";
import { useTableConfig } from "../../hooks/useTableConfig";
import { useTransforms } from "../../hooks/useTransforms";
import { ChatInput } from "../chat";
import { TablePanelSkeleton } from "../SkeletonLoader";
import TablePanel from "../TablePanel";
import { ActivityLog } from "./ActivityLog";
import styles from "./TableView.module.css";

/** Full-width table view with inline chat input and activity log overlay. */
export function TableView() {
  const { datasetId } = useParams<{ datasetId: string }>();
  const queryClient = useQueryClient();

  const {
    messages,
    input,
    setInput,
    isLoading: chatLoading,
    handleSubmit,
    registerToolHandler,
    registerTableSchema,
    registerDatasetId,
    channel,
    isStreaming,
    streamingContent,
  } = useChatContext();

  const { data: dataset, isLoading } = useDatasetQuery(datasetId);

  const {
    table,
    data,
    columnFilters,
    setColumnFilters,
    sorting,
    setSorting,
    columnVisibility,
    setColumnVisibility,
    setData,
    refresh: refreshData,
  } = useTableConfig({ dataset: dataset ?? null });

  // Restore cached table state on mount
  useEffect(() => {
    if (datasetId && tableStateCache.has(datasetId)) {
      const cached = tableStateCache.get(datasetId)!;
      setColumnFilters(cached.columnFilters);
      setSorting(cached.sorting);
      setColumnVisibility(cached.columnVisibility);
    }
  }, [datasetId, setColumnFilters, setSorting, setColumnVisibility]);

  // Save table state to cache on state changes (for restore on re-mount)
  useEffect(() => {
    if (datasetId) {
      tableStateCache.set(datasetId, { columnFilters, sorting, columnVisibility });
    }
  }, [datasetId, columnFilters, sorting, columnVisibility]);

  const {
    transforms,
    saveTransform,
    toggleTransform,
  } = useTransforms({
    dataset: dataset ?? null,
    onFilterApply: setColumnFilters,
    autoApplyActive: true,
    onFiltersChanged: refreshData,
  });

  const handleRefreshDataset = useCallback(() => {
    if (!datasetId) return;
    queryClient.invalidateQueries({
      queryKey: datasetKeys.detail(datasetId),
      exact: true,
    });
  }, [queryClient, datasetId]);

  // Tool call execution — same pattern as DatasetDetail
  const executeToolCall = useCallback(
    async (toolCall: ToolCall): Promise<string> => {
      if (!datasetId) return "No dataset";
      const context: ToolCallContext = {
        setColumnFilters,
        setSorting,
        setData,
        datasetId,
        transforms: (dataset?.transforms ?? []).map((t) => ({
          id: t.id,
          name: t.name,
          status: t.status,
          transform_type: t.transform_type ?? "filter",
          target_column: t.target_column,
          expression_config: t.expression_config,
          created_at: t.created_at,
        })),
        queryClient,
        catalog,
      };
      const result = await executeToolCallFn(toolCall, context);
      if (toolCall.function.name === "filterTable") {
        try {
          const args = JSON.parse(toolCall.function.arguments);
          const raqbJson = filterTableToRaqb(args);
          const description = generateFilterDescription(args);
          const conditionSql = raqbToSql(raqbJson);
          await saveTransform({
            name: description,
            condition_json: raqbJson,
            condition_sql: conditionSql,
          });
        } catch (e) {
          console.error("Failed to persist transform:", e);
        }
        handleRefreshDataset();
      }
      if (toolCall.function.name === "replaceColumnFilter") {
        try {
          const args = JSON.parse(toolCall.function.arguments) as {
            column: string;
            filters: Array<{ operator: string; value: unknown }>;
          };
          const idsToDisable = getTransformIdsForColumn(transforms, args.column);
          for (const id of idsToDisable) {
            await toggleTransform(id, false);
          }
          if (args.filters?.length) {
            for (const f of args.filters) {
              const raqbJson = filterTableToRaqb({
                column: args.column,
                operator: f.operator,
                value: f.value,
              });
              const description = generateFilterDescription({
                column: args.column,
                operator: f.operator,
                value: f.value,
              });
              const conditionSql = raqbToSql(raqbJson);
              await saveTransform({
                name: description,
                condition_json: raqbJson,
                condition_sql: conditionSql,
              });
            }
          }
        } catch (e) {
          console.error("Failed to persist replaceColumnFilter:", e);
        }
        handleRefreshDataset();
      }
      return result;
    },
    [
      setColumnFilters, setSorting, setData, datasetId, dataset,
      queryClient, handleRefreshDataset, saveTransform, toggleTransform, transforms,
    ],
  );

  // Register tool handler with ChatContext
  useEffect(() => {
    registerToolHandler({ executeToolCall });
    return () => registerToolHandler(null);
  }, [executeToolCall, registerToolHandler]);

  // Register dataset ID with ChatContext
  useEffect(() => {
    if (datasetId) {
      registerDatasetId(datasetId);
    }
    return () => registerDatasetId(null);
  }, [datasetId, registerDatasetId]);

  // Update channel's datasetId if different from current
  useEffect(() => {
    if (channel && datasetId) {
      const currentDatasetId = (channel.data as Record<string, unknown>)?.datasetId;
      if (currentDatasetId !== datasetId) {
        channel.updatePartial({ set: { datasetId } }).catch(console.error);
      }
    }
  }, [channel, datasetId]);

  // Register table schema with ChatContext
  const aliasMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of dataset?.transforms ?? []) {
      if (
        t.status === "enabled" &&
        t.transform_type === "alias" &&
        t.target_column &&
        t.expression_config
      ) {
        const alias = (t.expression_config as Record<string, unknown>).alias as string | undefined;
        if (alias) map.set(t.target_column, alias);
      }
    }
    return map;
  }, [dataset?.transforms]);

  const activeFilters = useMemo(
    () =>
      columnFilters.flatMap((f) => {
        const conditions = toConditions(f.value);
        return conditions.map((c) => ({
          column: f.id,
          operator: c.operator,
          value: c.value,
        }));
      }),
    [columnFilters],
  );

  useEffect(() => {
    if (dataset) {
      const schemaColumns = Object.entries(dataset.schema_config.fields).map(
        ([id, f]) => ({
          id,
          type: (f.type === "number"
            ? "number"
            : f.type === "boolean"
              ? "boolean"
              : "string") as "string" | "number" | "boolean",
          ...(dataset.column_profiles?.[id] && {
            profile: dataset.column_profiles[id],
          }),
          ...(aliasMap.has(id) && { alias: aliasMap.get(id) }),
        }),
      );

      const isActiveCleaningTransform = (t: {
        status: string;
        transform_type: string | null;
      }) => t.status === "enabled" && t.transform_type !== "filter";

      const activeCleaningTransforms = (dataset.transforms ?? [])
        .filter(isActiveCleaningTransform)
        .map((t) => {
          const config = t.expression_config as Record<string, unknown> | null;
          return {
            id: t.id,
            column: t.target_column ?? "",
            operation: (config?.operation as string) ?? t.transform_type,
            details: t.expression_sql ?? undefined,
          };
        });

      registerTableSchema({
        columns: schemaColumns,
        rowCount: data.length,
        activeFilters,
        activeCleaningTransforms:
          activeCleaningTransforms.length > 0
            ? activeCleaningTransforms
            : undefined,
        formatContext: dataset.format_context ?? undefined,
      });
    }
  }, [dataset, data.length, registerTableSchema, aliasMap, activeFilters]);

  if (isLoading && !dataset) {
    return <div className={styles.loading}>Loading dataset...</div>;
  }

  if (!dataset || !datasetId) {
    return <div className={styles.loading}>Dataset not found</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.tableArea}>
        <TablePanel
          table={table}
          columnFilters={columnFilters}
          setColumnFilters={setColumnFilters}
          totalRows={data.length}
          onToggleTransform={toggleTransform}
        />
      </div>
      <ActivityLog
        messages={messages}
        isStreaming={isStreaming}
        streamingContent={streamingContent}
      />
      <div className={styles.inputBar}>
        <ChatInput
          input={input}
          setInput={setInput}
          onSubmit={handleSubmit}
          isLoading={chatLoading}
          datasetName={dataset.name}
        />
      </div>
    </div>
  );
}
