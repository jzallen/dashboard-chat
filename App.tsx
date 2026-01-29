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
import { getDataset, getProject, type Dataset, type Project } from "./src/lib/api";

const DEFAULT_DATASET_ID = "1592ce82-5f22-4da7-b41b-9fd9fd05770e";

export default function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [project, setProject] = useState<Project | null>(null);
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
    console.log("[App] fetchDataset called");
    setDatasetError(null);
    try {
      console.log("[App] Calling getDataset...");
      const datasetData = await getDataset(DEFAULT_DATASET_ID, {
        includeTransforms: true,
      });
      console.log("[App] getDataset returned:", datasetData);
      console.log("[App] Setting dataset state...");
      setDataset(datasetData);
      console.log("[App] Dataset state set");
      
      // Fetch project info if we have a project_id
      if (datasetData.project_id) {
        try {
          const projectData = await getProject(datasetData.project_id);
          setProject(projectData);
        } catch {
          // Project fetch is non-critical, continue without it
        }
      }
    } catch (err) {
      console.error("[App] fetchDataset error:", err);
      setDatasetError(err instanceof Error ? err.message : "Failed to load dataset");
    }
  }, []); // No dependencies - stable reference

  // Fetch dataset on mount
  useEffect(() => {
    console.log("[App] useEffect mount triggered");
    const loadInitialData = async () => {
      console.log("[App] loadInitialData starting");
      await fetchDataset();
      console.log("[App] fetchDataset completed, calling refreshData");
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

  console.log("[App] Render - dataset:", dataset, "datasetError:", datasetError);

  return (
    <div className={styles.appContainer}>
      <div className={styles.mainContent}>
        {!dataset ? (
          <TablePanelSkeleton />
        ) : showSettings ? (
          <TransformSettings
            datasetId={dataset.id}
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
            projectName={project?.name}
            datasetName={dataset?.name}
            onSettingsClick={() => setShowSettings(true)}
          />
        )}
      </div>
      <ChatPanel {...chat} />
    </div>
  );
}
