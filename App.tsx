// Frontend - Quill Take Home Project
// React + TanStack Table + Chat UI with SSE streaming

import { useCallback, useEffect, useState } from "react";
import {
  useTableConfig,
  useChat,
  TablePanel,
  ChatPanel,
  tableSchema,
} from "./src/lib/ui";
import {
  executeToolCall as executeToolCallFn,
  type ToolCall,
} from "./src/lib/table-tools";
import { usePipelines } from "./src/lib/ui/hooks/usePipelines";
import { FilterSettings } from "./src/lib/ui/components/FilterSettings";
import { TablePanelSkeleton } from "./src/lib/ui/components/SkeletonLoader";

const DEFAULT_DATASET_ID = "default-dataset-001";

export default function App() {
  const [showSettings, setShowSettings] = useState(false);

  const {
    table,
    data,
    columnFilters,
    setColumnFilters,
    setSorting,
    setData,
    refresh: refreshData,
  } = useTableConfig({
    datasetId: DEFAULT_DATASET_ID,
  });

  // Pipeline management (fetch all pipelines, not just active ones for settings view)
  const {
    pipelines,
    loading: pipelinesLoading,
    initialized: pipelinesInitialized,
    error: pipelinesError,
    fetchPipelines,
    applyPipeline,
    togglePipeline,
  } = usePipelines({
    datasetId: DEFAULT_DATASET_ID,
    onFilterApply: setColumnFilters,
    currentFilters: columnFilters,
    autoApplyActive: true,
    // Fetch data after pipelines are initialized and filters applied
    onInitialized: refreshData,
    // Refetch data when filters change (e.g., toggling active/inactive)
    onFiltersChanged: refreshData,
    activeOnly: false, // Fetch all pipelines so we can show inactive ones in settings
  });

  // Fetch pipelines on mount and after chat interactions
  useEffect(() => {
    fetchPipelines();
  }, [fetchPipelines]);

  const executeToolCall = useCallback(
    (toolCall: ToolCall): string => {
      const result = executeToolCallFn(toolCall, {
        setColumnFilters,
        setSorting,
        setData,
      });
      // Refresh pipelines after a generateFilter tool call
      if (toolCall.function.name === "generateFilter") {
        setTimeout(() => fetchPipelines(), 500);
      }
      return result;
    },
    [setColumnFilters, setSorting, setData, fetchPipelines]
  );

  const chat = useChat({
    executeToolCall,
    tableSchema: { ...tableSchema, rowCount: data.length },
  });

  return (
    <div className="flex h-screen bg-gray-50">
      <div className="flex flex-col flex-1">
        {!pipelinesInitialized ? (
          <TablePanelSkeleton />
        ) : showSettings ? (
          <FilterSettings
            pipelines={pipelines}
            loading={pipelinesLoading}
            error={pipelinesError}
            onApply={applyPipeline}
            onToggle={togglePipeline}
            onRefresh={fetchPipelines}
            onClose={() => setShowSettings(false)}
          />
        ) : (
          <TablePanel
            table={table}
            columnFilters={columnFilters}
            setColumnFilters={setColumnFilters}
            totalRows={data.length}
            onSettingsClick={() => setShowSettings(true)}
          />
        )}
      </div>
      <ChatPanel {...chat} />
    </div>
  );
}
