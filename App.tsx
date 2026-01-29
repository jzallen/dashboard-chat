// Frontend - Quill Take Home Project
// React + TanStack Table + Chat UI with SSE streaming

import { useCallback, useEffect, useState } from "react";
import { Routes, Route, useParams, useNavigate } from "react-router-dom";
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
import { TablePanelSkeleton, ProjectViewSkeleton } from "./src/lib/ui/components/SkeletonLoader";
import { ProjectView } from "./src/lib/ui/components/ProjectView";
import { getDataset, getProject, type Dataset, type Project } from "./src/lib/api";

const DEFAULT_PROJECT_ID = "default-project-001";

/**
 * ProjectRoute - handles "/" route
 * Shows the project view with list of datasets
 */
function ProjectRoute() {
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const loadProject = async () => {
      try {
        const projectData = await getProject(DEFAULT_PROJECT_ID);
        setProject(projectData);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load project");
      }
    };
    loadProject();
  }, []);

  const handleSelectDataset = (datasetId: string) => {
    navigate(`/projects/${DEFAULT_PROJECT_ID}/datasets/${datasetId}`);
  };

  if (error) {
    return (
      <div className={styles.appContainer}>
        <div className={styles.mainContent}>
          <div style={{ padding: "2rem", color: "#dc2626" }}>Error: {error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.appContainer}>
      <div className={styles.mainContent}>
        {project ? (
          <ProjectView project={project} onSelectDataset={handleSelectDataset} />
        ) : (
          <ProjectViewSkeleton />
        )}
      </div>
    </div>
  );
}

/**
 * DatasetRoute - handles "/projects/:projectId/datasets/:datasetId"
 * Shows the table panel and chat panel for a specific dataset
 */
function DatasetRoute() {
  const { datasetId } = useParams<{ projectId: string; datasetId: string }>();
  const navigate = useNavigate();

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

  // Fetch dataset with transforms
  const fetchDataset = useCallback(async () => {
    if (!datasetId) return;

    setDatasetError(null);
    try {
      const datasetData = await getDataset(datasetId, {
        includeTransforms: true,
      });
      setDataset(datasetData);

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
      setDatasetError(err instanceof Error ? err.message : "Failed to load dataset");
    }
  }, [datasetId]);

  // Fetch dataset on mount or when datasetId changes
  useEffect(() => {
    const loadInitialData = async () => {
      await fetchDataset();
      refreshData();
    };
    loadInitialData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId]);

  // Transform management
  const {
    transforms,
    loading: transformsLoading,
    error: transformsError,
    toggleTransform,
    removeTransform,
  } = useTransforms({
    dataset,
    onDatasetChange: setDataset,
    onFilterApply: setColumnFilters,
    currentFilters: columnFilters,
    autoApplyActive: true,
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

  const handleProjectClick = () => {
    navigate("/");
  };

  if (datasetError) {
    return (
      <div className={styles.appContainer}>
        <div className={styles.mainContent}>
          <div style={{ padding: "2rem", color: "#dc2626" }}>Error: {datasetError}</div>
        </div>
      </div>
    );
  }

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
            onDelete={removeTransform}
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
            onToggleTransform={toggleTransform}
            onProjectClick={handleProjectClick}
          />
        )}
      </div>
      <ChatPanel {...chat} />
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ProjectRoute />} />
      <Route path="/projects/:projectId/datasets/:datasetId" element={<DatasetRoute />} />
    </Routes>
  );
}
