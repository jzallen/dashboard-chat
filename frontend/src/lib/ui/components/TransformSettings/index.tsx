import { XMarkIcon } from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";

import { withAuth } from "@/auth";
import { createDataCatalog, type Dataset, type Transform } from "@/dataCatalog";

const catalog = createDataCatalog(withAuth(fetch));

import { TransformList } from "./TransformList";
import styles from "./TransformSettings.module.css";

type ViewMode = "transforms" | "sql";

interface TransformSettingsProps {
  datasetId: string;
  transforms: Transform[];
  loading: boolean;
  error: string | null;
  onToggle: (transformId: string, isActive: boolean) => void;
  onDelete?: (transformId: string) => void;
  onRefresh: () => void;
  onClose: () => void;
}

/** Settings panel for managing saved transforms (filters, aliases, cleaning) with toggle/delete and SQL preview. */
export function TransformSettings({
  datasetId,
  transforms,
  loading,
  error,
  onToggle,
  onDelete,
  onRefresh,
  onClose,
}: TransformSettingsProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("transforms");
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [sqlLoading, setSqlLoading] = useState(false);
  const [sqlError, setSqlError] = useState<string | null>(null);

  useEffect(() => {
    if (viewMode === "sql") {
      fetchDatasetWithSql();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchDatasetWithSql only depends on datasetId, which is already in deps
  }, [viewMode, datasetId]);

  const fetchDatasetWithSql = async () => {
    setSqlLoading(true);
    setSqlError(null);
    try {
      // Fetch dataset with transforms to get staging_sql
      const data = await catalog.getDataset(datasetId, {
        includeTransforms: true,
      });
      setDataset(data);
    } catch (err) {
      setSqlError(err instanceof Error ? err.message : "Failed to load SQL");
    } finally {
      setSqlLoading(false);
    }
  };

  return (
    <div className={styles.settingsContainer}>
      {/* Settings Header */}
      <div className={styles.settingsHeader}>
        <div className={styles.headerContent}>
          <div>
            <h1 className={styles.settingsTitle}>Transform Settings</h1>
            <p className={styles.settingsDescription}>
              Manage your saved transforms - toggle them on or off
            </p>
          </div>
          <button
            onClick={onClose}
            className={styles.closeButton}
            title="Back to table"
          >
            <XMarkIcon className={styles.closeIcon} />
          </button>
        </div>

        {/* View Toggle Tabs */}
        <div className={styles.tabsContainer}>
          <button
            onClick={() => setViewMode("transforms")}
            className={`${styles.tab} ${viewMode === "transforms" ? styles.tabActive : ""}`}
          >
            Transforms
          </button>
          <button
            onClick={() => setViewMode("sql")}
            className={`${styles.tab} ${viewMode === "sql" ? styles.tabActive : ""}`}
          >
            SQL Preview
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className={styles.contentArea}>
        {viewMode === "transforms" ? (
          <TransformList
            transforms={transforms}
            loading={loading}
            error={error}
            onToggle={onToggle}
            onDelete={onDelete}
            onRefresh={onRefresh}
          />
        ) : (
          <div className={styles.sqlViewContainer}>
            {sqlLoading && (
              <div className={styles.sqlLoading}>Loading SQL...</div>
            )}
            {sqlError && (
              <div className={styles.sqlError}>
                <p>Error loading SQL: {sqlError}</p>
              </div>
            )}
            {dataset && !sqlLoading && !sqlError && (
              <div className={styles.sqlContent}>
                <div className={styles.sqlInfo}>
                  <p className={styles.sqlInfoText}>
                    <span className={styles.sqlInfoLabel}>
                      Active Transforms:
                    </span>{" "}
                    {
                      dataset.transforms.filter((t) => t.status === "enabled")
                        .length
                    }
                  </p>
                </div>
                <div className={styles.sqlWell}>
                  <div className={styles.sqlWellHeader}>
                    <span className={styles.sqlWellTitle}>SQL Query</span>
                  </div>
                  <pre className={styles.sqlCode}>
                    <code>{dataset.staging_sql || "No active transforms"}</code>
                  </pre>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
