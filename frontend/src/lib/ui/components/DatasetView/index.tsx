import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate, useOutletContext } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { type Dataset, type Project } from "@/api";
import { executeToolCall as executeToolCallFn, type ToolCall } from "@/table-tools";
import { filterTableToRaqb, generateFilterDescription } from "@/chat/tanstackToRaqb";
import { raqbToSql } from "@/raqb";
import { useTableConfig } from "../../hooks/useTableConfig";
import { useTransforms } from "../../hooks/useTransforms";
import { useDatasetQuery, usePrefetchDataset, datasetKeys } from "../../hooks/useDatasetQuery";
import { useRenameDataset } from "../../hooks/useDatasetMutations";
import { useChatContext } from "../../context/ChatContext";
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
}

function DatasetDetail({
  datasetId,
  viewMode,
  showSettings,
  onShowSettings,
}: DatasetDetailProps) {
  const queryClient = useQueryClient();
  const { registerToolHandler, registerTableSchema } = useChatContext();
  const { data: dataset, isLoading } = useDatasetQuery(datasetId);

  const {
    table,
    data,
    columnFilters,
    setColumnFilters,
    setSorting,
    setData,
    refresh: refreshData,
  } = useTableConfig({ dataset: dataset ?? null });

  const {
    transforms,
    loading: transformsLoading,
    error: transformsError,
    saveTransform,
    toggleTransform,
    removeTransform,
  } = useTransforms({
    dataset: dataset ?? null,
    onDatasetChange: (d) => {
      queryClient.setQueryData<Dataset>(datasetKeys.detail(datasetId), d);
    },
    onFilterApply: setColumnFilters,
    currentFilters: columnFilters,
    autoApplyActive: true,
    onFiltersChanged: refreshData,
  });

  const handleRefreshDataset = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: datasetKeys.detail(datasetId) });
  }, [queryClient, datasetId]);

  const executeToolCall = useCallback(
    (toolCall: ToolCall): string => {
      const result = executeToolCallFn(toolCall, {
        setColumnFilters,
        setSorting,
        setData,
      });
      if (toolCall.function.name === "filterTable") {
        // Persist as a backend transform so it survives mode toggles and page reloads
        try {
          const args = JSON.parse(toolCall.function.arguments);
          const raqbJson = filterTableToRaqb(args);
          const description = generateFilterDescription(args);
          const conditionSql = raqbToSql(raqbJson);
          saveTransform({
            name: description,
            condition_json: raqbJson,
            condition_sql: conditionSql,
          });
        } catch (e) {
          console.error("Failed to persist transform:", e);
        }
        setTimeout(() => handleRefreshDataset(), 500);
      }
      return result;
    },
    [setColumnFilters, setSorting, setData, handleRefreshDataset, saveTransform]
  );

  useEffect(() => {
    registerToolHandler({ executeToolCall });
    return () => registerToolHandler(null);
  }, [executeToolCall, registerToolHandler]);

  useEffect(() => {
    if (dataset) {
      const schemaColumns = Object.entries(dataset.schema_config.fields).map(([id, f]) => ({
        id,
        type: (f.type === "number" ? "number" : f.type === "boolean" ? "boolean" : "string") as "string" | "number" | "boolean",
      }));
      registerTableSchema({ columns: schemaColumns, rowCount: data.length });
    }
  }, [dataset, data.length, registerTableSchema]);

  if (isLoading && !dataset) {
    return <TablePanelSkeleton />;
  }

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
        onRefresh={handleRefreshDataset}
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
  const queryClient = useQueryClient();

  const [viewMode, setViewMode] = useState<ViewMode>("catalog");
  const [showSettings, setShowSettings] = useState(false);
  const [syncState, setSyncState] = useState<"idle" | "spinning" | "success" | "cooldown">("idle");
  const syncTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const handleSync = useCallback(() => {
    if (syncState !== "idle" || !datasetId) return;
    setSyncState("spinning");

    queryClient.invalidateQueries({ queryKey: datasetKeys.detail(datasetId) })
      .then(() => {
        setSyncState("success");
        syncTimerRef.current = setTimeout(() => {
          setSyncState("cooldown");
          syncTimerRef.current = setTimeout(() => setSyncState("idle"), 10_000);
        }, 1200);
      });
  }, [syncState, datasetId, queryClient]);

  const prefetchDataset = usePrefetchDataset();
  const { data: fullDataset } = useDatasetQuery(datasetId);

  // Derive dataset name: full dataset cache first, fall back to sparse entry
  const sparseEntry = project?.datasets.find((ds) => ds.id === datasetId);
  const datasetName = fullDataset?.name ?? sparseEntry?.name;

  const projectId = project?.id ?? "";
  const renameMutation = useRenameDataset(projectId);

  // Reset view state when dataset changes
  useEffect(() => {
    setViewMode("catalog");
    setShowSettings(false);
    setSyncState("idle");
    return () => clearTimeout(syncTimerRef.current);
  }, [datasetId]);

  // Prefetch dataset on selection (via URL)
  useEffect(() => {
    if (datasetId) {
      prefetchDataset(datasetId);
    }
  }, [datasetId, prefetchDataset]);

  const handleCardSelect = (id: string) => {
    if (!project) return;
    prefetchDataset(id);
    navigate(`/projects/${project.id}/datasets/${id}`);
  };

  const handleProjectClick = () => {
    if (!project) return;
    navigate(`/projects/${project.id}`);
  };

  const { addMessage } = useChatContext();

  const handleDatasetRename = useCallback(
    async (name: string) => {
      if (!datasetId) return;
      try {
        await renameMutation.mutateAsync({ datasetId, name });
        addMessage({
          id: String(Date.now()),
          role: "assistant",
          content: `Dataset renamed to '${name}'.`,
        });
      } catch (err) {
        console.error("Failed to rename dataset:", err);
      }
    },
    [datasetId, renameMutation, addMessage]
  );

  if (!project) {
    return <TablePanelSkeleton />;
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
            {viewMode === "table" && (
              <button
                onClick={handleSync}
                disabled={syncState !== "idle"}
                className={`${styles.syncButton} ${syncState === "spinning" ? styles.syncSpinning : ""} ${syncState === "success" ? styles.syncSuccess : ""} ${syncState === "cooldown" ? styles.syncCooldown : ""}`}
                title="Sync dataset from server"
              >
                {syncState === "success" ? (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                    className={styles.settingsIcon}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4.5 12.75l6 6 9-13.5"
                    />
                  </svg>
                ) : (
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
                      d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992"
                    />
                  </svg>
                )}
              </button>
            )}
            <ViewModeToggle mode={viewMode} onModeChange={setViewMode} />
          </div>
        )}
      </div>

      {/* Content */}
      <div className={styles.catalogLayout}>
        {/* DatasetGrid: shown in catalog mode or when no dataset selected */}
        {(viewMode === "catalog" || !hasSelection) && (
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
        )}

        {/* DatasetDetail: single mount point preserves state across mode switches */}
        {hasSelection && datasetId && (
          <DatasetDetail
            key={datasetId}
            datasetId={datasetId}
            viewMode={viewMode}
            showSettings={showSettings}
            onShowSettings={setShowSettings}
          />
        )}
      </div>
    </div>
  );
}
