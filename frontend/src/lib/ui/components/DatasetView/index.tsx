import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useOutletContext,useParams } from "react-router-dom";

import { exportDbtProject } from "@/api";
import { raqbToSql } from "@/raqb";
import { filterTableToRaqb, generateFilterDescription } from "@/raqb/tanstackToRaqb";
import { executeToolCall as executeToolCallFn, type ToolCall, type ToolCallContext } from "@/table-tools";

import { useChatContext } from "../../context/ChatContext";
import { getTransformIdsForColumn,toConditions } from "../../hooks/filterUtils";
import { useRenameDataset } from "../../hooks/useDatasetMutations";
import { datasetKeys, useDatasetQuery, useDatasets, usePrefetchDataset } from "../../hooks/useDatasetQuery";
import { useTableConfig } from "../../hooks/useTableConfig";
import { useTransforms } from "../../hooks/useTransforms";
import type { AppShellContext } from "../AppShell";
import { TablePanelSkeleton } from "../SkeletonLoader";
import { SqlAccessPanel } from "../SqlAccessPanel";
import TablePanel from "../TablePanel";
import { TransformSettings } from "../TransformSettings";
import { Breadcrumb } from "./Breadcrumb";
import { DatasetGrid } from "./DatasetCarousel";
import styles from "./DatasetView.module.css";
import { SchemaTable } from "./SchemaTable";
import { type ViewMode,ViewModeToggle } from "./ViewModeToggle";

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
  const { registerToolHandler, registerTableSchema, registerDatasetId } = useChatContext();
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
    onFilterApply: setColumnFilters,
    autoApplyActive: true,
    onFiltersChanged: refreshData,
  });

  const handleRefreshDataset = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: datasetKeys.detail(datasetId), exact: true });
  }, [queryClient, datasetId]);

  const executeToolCall = useCallback(
    async (toolCall: ToolCall): Promise<string> => {
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
              const raqbJson = filterTableToRaqb({ column: args.column, operator: f.operator, value: f.value });
              const description = generateFilterDescription({ column: args.column, operator: f.operator, value: f.value });
              const conditionSql = raqbToSql(raqbJson);
              await saveTransform({
                name: description,
                condition_json: raqbJson,
                condition_sql: conditionSql,
              });
            }
          }
        } catch (e) {
          console.error("Failed to persist replaceColumnFilter transform:", e);
        }
        handleRefreshDataset();
      }
      return result;
    },
    [setColumnFilters, setSorting, setData, datasetId, dataset, queryClient, handleRefreshDataset, saveTransform, toggleTransform, transforms]
  );

  useEffect(() => {
    registerToolHandler({ executeToolCall });
    return () => registerToolHandler(null);
  }, [executeToolCall, registerToolHandler]);

  useEffect(() => {
    registerDatasetId(datasetId);
    return () => registerDatasetId(null);
  }, [datasetId, registerDatasetId]);

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
        return conditions.map((c) => ({ column: f.id, operator: c.operator, value: c.value }));
      }),
    [columnFilters]
  );

  useEffect(() => {
    if (dataset) {
      const schemaColumns = Object.entries(dataset.schema_config.fields).map(([id, f]) => ({
        id,
        type: (f.type === "number" ? "number" : f.type === "boolean" ? "boolean" : "string") as "string" | "number" | "boolean",
        ...(dataset.column_profiles?.[id] && { profile: dataset.column_profiles[id] }),
        ...(aliasMap.has(id) && { alias: aliasMap.get(id) }),
      }));

      const activeCleaningTransforms = (dataset.transforms ?? [])
        .filter((t) => t.status === "enabled" && t.transform_type !== "filter")
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
        activeCleaningTransforms: activeCleaningTransforms.length > 0 ? activeCleaningTransforms : undefined,
      });
    }
  }, [dataset, data.length, registerTableSchema, aliasMap, activeFilters]);

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
  const [showSqlAccess, setShowSqlAccess] = useState(false);
  const [syncState, setSyncState] = useState<"idle" | "spinning" | "success" | "cooldown">("idle");
  const syncTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleSync = useCallback(() => {
    if (syncState !== "idle" || !datasetId) return;
    setSyncState("spinning");

    queryClient.invalidateQueries({ queryKey: datasetKeys.detail(datasetId), exact: true })
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
  const { data: datasets = [] } = useDatasets(project?.id);

  // Derive dataset name: full dataset cache first, fall back to sparse entry
  const sparseEntry = datasets.find((ds) => ds.id === datasetId);
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

  useEffect(() => {
    if (!exportError) return;
    const timer = setTimeout(() => setExportError(null), 5000);
    return () => clearTimeout(timer);
  }, [exportError]);

  const handleCardSelect = (id: string) => {
    if (!project) return;
    prefetchDataset(id);
    navigate(`/projects/${project.id}/datasets/${id}`);
  };

  const handleProjectClick = () => {
    if (!project) return;
    navigate(`/projects/${project.id}`);
  };

  const handleExportDbt = async () => {
    if (!project?.id) return;
    setIsExporting(true);
    setExportError(null);
    try {
      await exportDbtProject(project.id);
    } catch (err) {
      console.error("dbt export failed:", err);
      setExportError("Export failed. Please try again.");
    } finally {
      setIsExporting(false);
    }
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
        <div className={styles.headerActions}>
          <button
            onClick={handleExportDbt}
            disabled={isExporting}
            className={styles.settingsButton}
            title="Export as dbt project"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className={styles.settingsIcon}
              style={isExporting ? { opacity: 0.5 } : undefined}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
              />
            </svg>
          </button>
          {exportError && (
            <span style={{ color: "var(--color-danger, #ef4444)", fontSize: "0.75rem" }}>
              {exportError}
            </span>
          )}
          <button
            onClick={() => {
              setShowSqlAccess((v) => !v);
              if (!showSqlAccess) setShowSettings(false);
            }}
            className={`${styles.settingsButton} ${showSqlAccess ? styles.settingsButtonActive : ""}`}
            title="SQL Access"
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
                d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125v-3.75"
              />
            </svg>
          </button>
        {hasSelection && (
          <>
            {viewMode === "table" && datasetId && (
              <button
                onClick={() => navigate(`/projects/${projectId}/datasets/${datasetId}/sessions`)}
                className={styles.settingsButton}
                title="View chat sessions"
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
                    d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </button>
            )}
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
          </>
        )}
        </div>
      </div>

      {/* Content */}
      <div className={styles.catalogLayout}>
        {showSqlAccess ? (
          <div className={styles.sqlAccessSection}>
            <SqlAccessPanel projectId={projectId} />
          </div>
        ) : (
          <>
            {/* DatasetGrid: shown in catalog mode or when no dataset selected */}
            {(viewMode === "catalog" || !hasSelection) && (
              <div className={hasSelection ? styles.gridSection : styles.gridSectionFull}>
                {datasets.length === 0 ? (
                  <div className={styles.emptyState}>No datasets in this project</div>
                ) : (
                  <DatasetGrid
                    datasets={datasets}
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
          </>
        )}
      </div>
    </div>
  );
}
