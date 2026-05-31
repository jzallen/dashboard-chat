import type { ColumnFiltersState, SortingState, VisibilityState } from "@tanstack/react-table";
import { useCallback, useEffect, useMemo } from "react";
import { useParams } from "react-router";

/** Module-level cache for table state across navigations, keyed by datasetId. */
const tableStateCache = new Map<string, { columnFilters: ColumnFiltersState; sorting: SortingState; columnVisibility: VisibilityState }>();

import { deriveAssistantChanges } from "../../../core/chat/assistantChanges";
import { useChatContext } from "../../context/ChatContext";
import { toConditions } from "../../hooks/filterUtils";
import { useDatasetQuery } from "../../hooks/useDatasetQuery";
import { useModelDependencies } from "../../hooks/useModelDependencies";
import { useTableConfig } from "../../hooks/useTableConfig";
import { useTransforms } from "../../hooks/useTransforms";
import { ChatInput } from "../chat";
import {
  AssistantChangesPanel,
  CompiledSqlPanel,
  DatasetColumnsTable,
  DependencyStrip,
  ModelDetailLayout,
} from "../ModelDetail";
import TablePanel from "../TablePanel";
import { ActivityLog } from "./ActivityLog";
import styles from "./TableView.module.css";

/** Dataset detail page — single-page model-detail layout (MR-5). */
export function TableView() {
  const { datasetId } = useParams<{ datasetId: string }>();

  const {
    messages,
    input,
    setInput,
    isLoading: chatLoading,
    handleSubmit,
    registerTableApi,
    registerTableSchema,
    setContext,
    channel,
    isStreaming,
    streamingContent,
  } = useChatContext();

  const { data: dataset, isLoading } = useDatasetQuery(datasetId);
  const dependencies = useModelDependencies(dataset?.project_id, datasetId);

  const {
    table,
    data,
    columnFilters,
    setColumnFilters,
    sorting,
    setSorting,
    columnVisibility,
    setColumnVisibility,
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
    toggleTransform,
  } = useTransforms({
    dataset: dataset ?? null,
    onFilterApply: setColumnFilters,
    autoApplyActive: true,
    onFiltersChanged: refreshData,
  });

  const resetColumnFilters = useCallback(
    () => setColumnFilters([]),
    [setColumnFilters],
  );

  // Expose a TableApi to ChatContext so SSE-driven UI directives flow
  // through the shared applyDirective body — see DatasetView for rationale.
  useEffect(() => {
    registerTableApi({ setSorting, setColumnFilters, resetColumnFilters });
    return () => registerTableApi(null);
  }, [registerTableApi, setSorting, setColumnFilters, resetColumnFilters]);

  // Register dataset context
  useEffect(() => {
    if (datasetId) {
      setContext("dataset", datasetId);
    }
    return () => setContext(null, null);
  }, [datasetId, setContext]);

  // Update channel's context if different from current
  useEffect(() => {
    if (channel && datasetId) {
      const channelData = channel.data as Record<string, unknown> | undefined;
      const currentDatasetId = channelData?.datasetId;
      if (currentDatasetId !== datasetId) {
        channel.updatePartial({ set: { datasetId, contextType: "dataset", contextId: datasetId } }).catch(console.error);
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
    <ModelDetailLayout
      title={dataset.name}
      description={dataset.description}
      activityLog={
        <ActivityLog
          messages={messages}
          isStreaming={isStreaming}
          streamingContent={streamingContent}
        />
      }
      inputBar={
        <div className={styles.inputBar}>
          <ChatInput
            input={input}
            setInput={setInput}
            onSubmit={handleSubmit}
            isLoading={chatLoading}
            datasetName={dataset.name}
          />
        </div>
      }
    >
      <DependencyStrip
        upstream={dependencies.upstream}
        downstream={dependencies.downstream}
        isLoading={dependencies.isLoading}
      />
      <AssistantChangesPanel changes={deriveAssistantChanges(messages)} />
      <section className={styles.tableArea} data-testid="data-preview">
        <TablePanel
          table={table}
          columnFilters={columnFilters}
          setColumnFilters={setColumnFilters}
          totalRows={data.length}
          onToggleTransform={toggleTransform}
        />
      </section>
      <DatasetColumnsTable
        schema={dataset.schema_config}
        profiles={dataset.column_profiles}
      />
      <CompiledSqlPanel sql={dataset.staging_sql} title="Compiled SQL (staging)" />
    </ModelDetailLayout>
  );
}
