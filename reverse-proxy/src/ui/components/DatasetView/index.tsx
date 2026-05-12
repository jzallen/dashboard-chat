import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  CheckIcon,
  CircleStackIcon,
  ClockIcon,
  Cog6ToothIcon,
} from "@heroicons/react/24/outline";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";

import { withAuth } from "@/auth";
import { createDataCatalog } from "@/dataCatalog";

const catalog = createDataCatalog(withAuth(fetch));

import { useChatContext } from "../../context/ChatContext";
import { toConditions } from "../../hooks/filterUtils";
import { useRenameDataset } from "../../hooks/useDatasetMutations";
import {
  datasetKeys,
  useDatasetQuery,
  useDatasets,
  usePrefetchDataset,
} from "../../hooks/useDatasetQuery";
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
import { type ViewMode, ViewModeToggle } from "./ViewModeToggle";

/** Inner component that mounts only when a dataset is selected. Contains all hooks requiring a datasetId. */
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
  const { registerTableApi, registerTableSchema, setContext } =
    useChatContext();
  const { data: dataset, isLoading } = useDatasetQuery(datasetId);

  const {
    table,
    data,
    columnFilters,
    setColumnFilters,
    setSorting,
    refresh: refreshData,
  } = useTableConfig({ dataset: dataset ?? null });

  const resetColumnFilters = useCallback(
    () => setColumnFilters([]),
    [setColumnFilters],
  );

  const {
    transforms,
    loading: transformsLoading,
    error: transformsError,
    toggleTransform,
    removeTransform,
  } = useTransforms({
    dataset: dataset ?? null,
    onFilterApply: setColumnFilters,
    autoApplyActive: true,
    onFiltersChanged: refreshData,
  });

  const handleRefreshDataset = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: datasetKeys.detail(datasetId),
      exact: true,
    });
  }, [queryClient, datasetId]);

  // Expose a TableApi to ChatContext so SSE-driven UI directives
  // (sort_directive / filter_directive / filters_cleared) flow through the
  // shared applyDirective body — same convergence point as direct UI clicks.
  useEffect(() => {
    registerTableApi({ setSorting, setColumnFilters, resetColumnFilters });
    return () => registerTableApi(null);
  }, [registerTableApi, setSorting, setColumnFilters, resetColumnFilters]);

  useEffect(() => {
    setContext("dataset", datasetId);
    return () => setContext(null, null);
  }, [datasetId, setContext]);

  const aliasMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of dataset?.transforms ?? []) {
      if (
        t.status === "enabled" &&
        t.transform_type === "alias" &&
        t.target_column &&
        t.expression_config
      ) {
        const alias = (t.expression_config as Record<string, unknown>).alias as
          | string
          | undefined;
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

/**
 * Orchestrator component for the dataset workspace.
 * Renders header with breadcrumb and actions, DatasetGrid for catalog browsing,
 * and conditionally mounts DatasetDetail when a dataset is selected.
 */
export function ProjectView() {
  const { datasetId } = useParams<{ projectId?: string; datasetId?: string }>();
  const { project } = useOutletContext<AppShellContext>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [viewMode, setViewMode] = useState<ViewMode>("catalog");
  const [showSettings, setShowSettings] = useState(false);
  const [showSqlAccess, setShowSqlAccess] = useState(false);
  const [syncState, setSyncState] = useState<
    "idle" | "spinning" | "success" | "cooldown"
  >("idle");
  const syncTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const scheduleSyncTransition = useCallback((from: "success" | "cooldown") => {
    if (from === "success") {
      syncTimerRef.current = setTimeout(() => {
        setSyncState("cooldown");
        scheduleSyncTransition("cooldown");
      }, 1200);
    } else {
      syncTimerRef.current = setTimeout(() => setSyncState("idle"), 10_000);
    }
  }, []);

  const handleSync = useCallback(() => {
    if (syncState !== "idle" || !datasetId) return;
    setSyncState("spinning");

    queryClient
      .invalidateQueries({
        queryKey: datasetKeys.detail(datasetId),
        exact: true,
      })
      .then(() => {
        setSyncState("success");
        scheduleSyncTransition("success");
      });
  }, [syncState, datasetId, queryClient, scheduleSyncTransition]);

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
      await catalog.exportDbtProject(project.id);
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
    [datasetId, renameMutation, addMessage],
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
            <ArrowDownTrayIcon
              className={styles.settingsIcon}
              style={isExporting ? { opacity: 0.5 } : undefined}
            />
          </button>
          {exportError && (
            <span
              style={{
                color: "var(--color-danger, #ef4444)",
                fontSize: "0.75rem",
              }}
            >
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
            <CircleStackIcon className={styles.settingsIcon} />
          </button>
          {hasSelection && (
            <>
              {viewMode === "table" && (
                <>
                  {datasetId && (
                    <button
                      onClick={() =>
                        navigate(
                          `/projects/${projectId}/datasets/${datasetId}/sessions`,
                        )
                      }
                      className={styles.settingsButton}
                      title="View chat sessions"
                    >
                      <ClockIcon className={styles.settingsIcon} />
                    </button>
                  )}
                  <button
                    onClick={() => setShowSettings((v) => !v)}
                    className={styles.settingsButton}
                    title="Manage saved transforms"
                  >
                    <Cog6ToothIcon className={styles.settingsIcon} />
                  </button>
                  <button
                    onClick={handleSync}
                    disabled={syncState !== "idle"}
                    className={clsx(styles.syncButton, {
                      [styles.syncSpinning]: syncState === "spinning",
                      [styles.syncSuccess]: syncState === "success",
                      [styles.syncCooldown]: syncState === "cooldown",
                    })}
                    title="Sync dataset from server"
                  >
                    {syncState === "success" ? (
                      <CheckIcon
                        className={styles.settingsIcon}
                        strokeWidth={2}
                      />
                    ) : (
                      <ArrowPathIcon className={styles.settingsIcon} />
                    )}
                  </button>
                </>
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
              <div
                className={
                  hasSelection ? styles.gridSection : styles.gridSectionFull
                }
              >
                {datasets.length === 0 ? (
                  <div className={styles.emptyState}>
                    No datasets in this project
                  </div>
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
