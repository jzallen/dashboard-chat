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
import { getDataset, type Dataset } from "./src/lib/api";

const DEFAULT_DATASET_ID = "default-dataset-001";

export default function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [datasetError, setDatasetError] = useState<string | null>(null);

  const {
    table,
    data,
    columnFilters,
    setColumnFilters,
    setSorting,
    setData,
    refresh: refreshData,
  } = useTableConfig();

  // Fetch dataset with transforms (silently refreshes after initial load)
  const fetchDataset = useCallback(async () => {
    setDatasetError(null);
    try {
      const data = await getDataset(DEFAULT_DATASET_ID, {
        includeTransforms: true,
      });
      setDataset(data);
    } catch (err) {
      setDatasetError(err instanceof Error ? err.message : "Failed to load dataset");
    }
  }, []); // No dependencies - stable reference

  // Fetch dataset on mount
  useEffect(() => {
    const loadInitialData = async () => {
      await fetchDataset();
      // Only refresh data on initial load
      refreshData();
    };
    loadInitialData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run only once on mount

  // Transform management
  const {
    transforms,
    loading: transformsLoading,
    error: transformsError,
    toggleTransform,
  } = useTransforms({
    dataset,
    onDatasetChange: setDataset,
    onFilterApply: setColumnFilters,
    currentFilters: columnFilters,
    autoApplyActive: true,
    // Refetch data when transforms change (e.g., toggling active/inactive)
    onFiltersChanged: refreshData,
  });

  const executeToolCall = useCallback(
    (toolCall: ToolCall): string => {
      const result = executeToolCallFn(toolCall, {
        setColumnFilters,
        setSorting,
        setData,
      });
      // Refresh dataset after a filterTable tool call
      if (toolCall.function.name === "filterTable") {
        setTimeout(() => fetchDataset(), 500);
      }
      return result;
    },
    [setColumnFilters, setSorting, setData, fetchDataset]
  );

  const chat = useChat({
    executeToolCall,
    tableSchema: { ...tableSchema, rowCount: data.length },
  });

  return (
    <div className={styles.appContainer}>
      <div className={styles.mainContent}>
        {!dataset ? (
          <TablePanelSkeleton />
        ) : showSettings ? (
          <TransformSettings
            transforms={transforms}
            loading={transformsLoading}
            error={transformsError ?? datasetError}
            onToggle={toggleTransform}
            onRefresh={fetchDataset}
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
