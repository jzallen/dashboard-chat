/**
 * Transform Settings View Component
 */

import type { Transform } from "@/api";
import { TransformList } from "./TransformList";
import styles from "./TransformSettings.module.css";

interface TransformSettingsProps {
  transforms: Transform[];
  loading: boolean;
  error: string | null;
  onToggle: (transformId: string, isActive: boolean) => void;
  onRefresh: () => void;
  onClose: () => void;
}

export function TransformSettings({
  transforms,
  loading,
  error,
  onToggle,
  onRefresh,
  onClose,
}: TransformSettingsProps) {
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
      </div>
      {/* Transform List */}
      <div className={styles.contentArea}>
        <TransformList
          transforms={transforms}
          loading={loading}
          error={error}
          onToggle={onToggle}
          onRefresh={onRefresh}
        />
      </div>
    </div>
  );
}
