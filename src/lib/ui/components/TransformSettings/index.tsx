/**
 * Transform Settings View Component
 */

import { useState, useEffect } from "react";
import type { Transform, AggregatedSqlResponse } from "@/api";
import { getDatasetAggregatedSql } from "@/api";
import { TransformList } from "./TransformList";
import styles from "./TransformSettings.module.css";

type ViewMode = "transforms" | "sql";

interface TransformSettingsProps {
  datasetId: string;
  transforms: Transform[];
  loading: boolean;
  error: string | null;
  onToggle: (transformId: string, isActive: boolean) => void;
  onRefresh: () => void;
  onClose: () => void;
}

export function TransformSettings({
  datasetId,
  transforms,
  loading,
  error,
  onToggle,
  onRefresh,
  onClose,
}: TransformSettingsProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("transforms");
  const [sqlData, setSqlData] = useState<AggregatedSqlResponse | null>(null);
  const [sqlLoading, setSqlLoading] = useState(false);
  const [sqlError, setSqlError] = useState<string | null>(null);

  useEffect(() => {
    if (viewMode === "sql") {
      fetchAggregatedSql();
    }
  }, [viewMode, datasetId]);

  const fetchAggregatedSql = async () => {
    setSqlLoading(true);
    setSqlError(null);
    try {
      const data = await getDatasetAggregatedSql(datasetId);
      setSqlData(data);
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
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className={styles.closeIcon}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
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
            {sqlData && !sqlLoading && !sqlError && (
              <div className={styles.sqlContent}>
                <div className={styles.sqlInfo}>
                  <p className={styles.sqlInfoText}>
                    <span className={styles.sqlInfoLabel}>Active Transforms:</span>{" "}
                    {sqlData.enabled_transform_count}
                  </p>
                </div>
                <div className={styles.sqlWell}>
                  <div className={styles.sqlWellHeader}>
                    <span className={styles.sqlWellTitle}>WHERE Clause</span>
                  </div>
                  <pre className={styles.sqlCode}>
                    <code>{sqlData.sql_where_clause || "No active transforms"}</code>
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
