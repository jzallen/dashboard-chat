import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate, useOutletContext } from "react-router-dom";
import { getDataset, updateDataset, type Dataset, type Project } from "@/api";
import { executeToolCall as executeToolCallFn, type ToolCall } from "@/table-tools";
import { useTableConfig } from "../../hooks/useTableConfig";
import { useTransforms } from "../../hooks/useTransforms";
import { useChatContext } from "../../context/ChatContext";
import { tableSchema } from "../../data/sampleData";
import TablePanel from "../TablePanel";
import { TransformSettings } from "../TransformSettings";
import { TablePanelSkeleton } from "../SkeletonLoader";
import { DatasetGrid } from "./DatasetCarousel";
import { SchemaTable } from "./SchemaTable";
import { ViewModeToggle, type ViewMode } from "./ViewModeToggle";
import { Breadcrumb } from "./Breadcrumb";
import styles from "./DatasetView.module.css";

interface AppShellContext {
  project: Project | null;
}

// ---------------------------------------------------------------------------
// DatasetDetail — inner component that only mounts when a dataset is selected.
// Contains all hooks that require a datasetId.
// ---------------------------------------------------------------------------

interface DatasetDetailProps {
  datasetId: string;
  viewMode: ViewMode;
  showSettings: boolean;
  onShowSettings: (show: boolean) => void;
  onDatasetLoaded: (dataset: Dataset) => void;
  onDatasetError: (error: string | null) => void;
}

function DatasetDetail({
  datasetId,
  viewMode,
  showSettings,
  onShowSettings,
  onDatasetLoaded,
  onDatasetError,
}: DatasetDetailProps) {
  const { registerToolHandler, registerTableSchema } = useChatContext();
  const [dataset, setDataset] = useState<Dataset | null>(null);

  const {
    table,
    data,
    columnFilters,
    setColumnFilters,
    setSorting,
    setData,
    refresh: refreshData,
  } = useTableConfig();

  const fetchDataset = useCallback(async () => {
    onDatasetError(null);
    try {
      const datasetData = await getDataset(datasetId, { includeTransforms: true });
      setDataset(datasetData);
      onDatasetLoaded(datasetData);
    } catch (err) {
      onDatasetError(err instanceof Error ? err.message : "Failed to load dataset");
    }
  }, [datasetId, onDatasetLoaded, onDatasetError]);

  useEffect(() => {
    const load = async () => {
      await fetchDataset();
      refreshData();
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId]);

  const {
    transforms,
    loading: transformsLoading,
    error: transformsError,
    toggleTransform,
    removeTransform,
  } = useTransforms({
    dataset,
    onDatasetChange: (d) => { setDataset(d); if (d) onDatasetLoaded(d); },
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
      if (toolCall.function.name === "filterTable") {
        setTimeout(() => fetchDataset(), 500);
      }
      return result;
    },
    [setColumnFilters, setSorting, setData, fetchDataset]
  );

  useEffect(() => {
    registerToolHandler({ executeToolCall });
    return () => registerToolHandler(null);
  }, [executeToolCall, registerToolHandler]);

  useEffect(() => {
    registerTableSchema({ ...tableSchema, rowCount: data.length });
  }, [data.length, registerTableSchema]);

  if (!dataset) {
    return <TablePanelSkeleton />;
  }

  if (viewMode === "catalog") {
    return (
      <div className={`${styles.schemaSection} ${styles.schemaSectionVisible}`}>
        <SchemaTable schemaConfig={dataset.schema_config} />
      </div>
    );
  }

  if (showSettings) {
    return (
      <TransformSettings
        datasetId={dataset.id}
        transforms={transforms}
        loading={transformsLoading}
        error={transformsError}
        onToggle={toggleTransform}
        onDelete={removeTransform}
        onRefresh={fetchDataset}
        onClose={() => onShowSettings(false)}
      />
    );
  }

  return (
    <div className={styles.tableSection}>
      <TablePanel
        table={table}
        columnFilters={columnFilters}
        setColumnFilters={setColumnFilters}
        totalRows={data.length}
        onToggleTransform={toggleTransform}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProjectView — orchestrator component. Renders header, DatasetGrid, and
// conditionally mounts DatasetDetail when a dataset is selected.
// ---------------------------------------------------------------------------

export function ProjectView() {
  const { datasetId } = useParams<{ projectId?: string; datasetId?: string }>();
  const { project } = useOutletContext<AppShellContext>();
  const navigate = useNavigate();

  const [viewMode, setViewMode] = useState<ViewMode>("catalog");
  const [showSettings, setShowSettings] = useState(false);
  const [datasetName, setDatasetName] = useState<string | undefined>();
  const [datasetError, setDatasetError] = useState<string | null>(null);

  // Reset state when dataset changes
  useEffect(() => {
    setViewMode("catalog");
    setShowSettings(false);
    setDatasetName(undefined);
  }, [datasetId]);

  const handleCardSelect = (id: string) => {
    if (!project) return;
    navigate(`/projects/${project.id}/datasets/${id}`);
  };

  const handleProjectClick = () => {
    if (!project) return;
    navigate(`/projects/${project.id}`);
  };

  const { addMessage } = useChatContext();

  const handleDatasetLoaded = useCallback((dataset: Dataset) => {
    setDatasetName(dataset.name);
  }, []);

  const handleDatasetError = useCallback((error: string | null) => {
    setDatasetError(error);
  }, []);

  const handleDatasetRename = useCallback(
    async (name: string) => {
      if (!datasetId) return;
      const previousName = datasetName;
      setDatasetName(name);
      try {
        await updateDataset(datasetId, { name });
        addMessage({
          id: String(Date.now()),
          role: "assistant",
          content: `Dataset renamed to '${name}'.`,
        });
      } catch (err) {
        setDatasetName(previousName);
        console.error("Failed to rename dataset:", err);
      }
    },
    [datasetId, datasetName, addMessage]
  );

  if (!project) {
    return <TablePanelSkeleton />;
  }

  if (datasetError) {
    return (
      <div className={styles.container}>
        <div style={{ padding: "2rem", color: "#dc2626" }}>Error: {datasetError}</div>
      </div>
    );
  }

  const hasSelection = Boolean(datasetId);

  return (
    <div className={styles.container}>
      {/* Header: breadcrumb + actions */}
      <div className={styles.header}>
        <Breadcrumb
          projectName={project.name}
          datasetName={datasetName}
          onProjectClick={hasSelection ? handleProjectClick : undefined}
          onDatasetRename={hasSelection ? handleDatasetRename : undefined}
          focusDatasetName={datasetName === "New Dataset"}
        />
        {hasSelection && (
          <div className={styles.headerActions}>
            {viewMode === "table" && (
              <button
                onClick={() => setShowSettings((v) => !v)}
                className={styles.settingsButton}
                title="Manage saved transforms"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className={styles.settingsIcon}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              </button>
            )}
            <ViewModeToggle mode={viewMode} onModeChange={setViewMode} />
          </div>
        )}
      </div>

      {/* Content */}
      {viewMode === "catalog" || !hasSelection ? (
        <div className={styles.catalogLayout}>
          {/* DatasetGrid: wrapping grid or horizontal row */}
          <div className={hasSelection ? styles.gridSection : styles.gridSectionFull}>
            {project.datasets.length === 0 ? (
              <div className={styles.emptyState}>No datasets in this project</div>
            ) : (
              <DatasetGrid
                datasets={project.datasets}
                selectedDatasetId={datasetId ?? null}
                onSelect={handleCardSelect}
                hasSelection={hasSelection}
              />
            )}
          </div>

          {/* DatasetDetail: schema table (catalog mode) */}
          {hasSelection && datasetId && (
            <DatasetDetail
              datasetId={datasetId}
              viewMode={viewMode}
              showSettings={showSettings}
              onShowSettings={setShowSettings}
              onDatasetLoaded={handleDatasetLoaded}
              onDatasetError={handleDatasetError}
            />
          )}
        </div>
      ) : (
        /* Table or settings mode */
        datasetId && (
          <DatasetDetail
            datasetId={datasetId}
            viewMode={viewMode}
            showSettings={showSettings}
            onShowSettings={setShowSettings}
            onDatasetLoaded={handleDatasetLoaded}
            onDatasetError={handleDatasetError}
          />
        )
      )}
    </div>
  );
}
