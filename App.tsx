// Frontend - Quill Take Home Project
// React + TanStack Table + Chat UI with SSE streaming

import { useCallback, useEffect } from "react";
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
import { PipelineList } from "./src/lib/ui/components/PipelineList";

const DEFAULT_DATASET_ID = "default-dataset-001";

export default function App() {
  const {
    table,
    data,
    columnFilters,
    setColumnFilters,
    setSorting,
    setData,
  } = useTableConfig();

  // Pipeline management
  const {
    pipelines,
    loading: pipelinesLoading,
    error: pipelinesError,
    fetchPipelines,
    applyPipeline,
    removePipeline,
  } = usePipelines({
    datasetId: DEFAULT_DATASET_ID,
    onFilterApply: setColumnFilters,
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
        <TablePanel
          table={table}
          columnFilters={columnFilters}
          setColumnFilters={setColumnFilters}
          totalRows={data.length}
        />
        {/* Saved Pipelines */}
        <div className="border-t border-gray-200 bg-white p-3">
          <PipelineList
            pipelines={pipelines}
            loading={pipelinesLoading}
            error={pipelinesError}
            onApply={applyPipeline}
            onDelete={removePipeline}
            onRefresh={fetchPipelines}
          />
        </div>
      </div>
      <ChatPanel {...chat} />
    </div>
  );
}
