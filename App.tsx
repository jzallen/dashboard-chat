// Frontend - Quill Take Home Project
// React + TanStack Table + Chat UI with SSE streaming

import { useCallback, useEffect, useState } from "react";
import styles from "./App.module.css";
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
import { useTransforms } from "./src/lib/ui/hooks/useTransforms";
import { TransformSettings } from "./src/lib/ui/components/TransformSettings";
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

  // Transform management (fetch all transforms, not just active ones for settings view)
  const {
    transforms,
    loading: transformsLoading,
    initialized: transformsInitialized,
    error: transformsError,
    fetchTransforms,
    toggleTransform,
  } = useTransforms({
    datasetId: DEFAULT_DATASET_ID,
    onFilterApply: setColumnFilters,
    currentFilters: columnFilters,
    autoApplyActive: true,
    // Fetch data after transforms are initialized and applied
    onInitialized: refreshData,
    // Refetch data when transforms change (e.g., toggling active/inactive)
    onFiltersChanged: refreshData,
    activeOnly: false, // Fetch all transforms so we can show inactive ones in settings
  });

  // Fetch transforms on mount and after chat interactions
  useEffect(() => {
    fetchTransforms();
  }, [fetchTransforms]);

  const executeToolCall = useCallback(
    (toolCall: ToolCall): string => {
      const result = executeToolCallFn(toolCall, {
        setColumnFilters,
        setSorting,
        setData,
      });
      // Refresh transforms after a filterTable tool call
      if (toolCall.function.name === "filterTable") {
        setTimeout(() => fetchTransforms(), 500);
      }
      return result;
    },
    [setColumnFilters, setSorting, setData, fetchTransforms]
  );

  const chat = useChat({
    executeToolCall,
    tableSchema: { ...tableSchema, rowCount: data.length },
  });

  return (
    <div className={styles.appContainer}>
      <div className={styles.mainContent}>
        {!transformsInitialized ? (
          <TablePanelSkeleton />
        ) : showSettings ? (
          <TransformSettings
            transforms={transforms}
            loading={transformsLoading}
            error={transformsError}
            onToggle={toggleTransform}
            onRefresh={fetchTransforms}
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
