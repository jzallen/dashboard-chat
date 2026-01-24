/**
 * TransformList component for displaying saved transforms
 */

import type { Transform } from "@/api";
import { TransformCard } from "./TransformCard/index";
import styles from "./TransformList.module.css";

interface TransformListProps {
  transforms: Transform[];
  loading: boolean;
  error: string | null;
  onToggle: (transformId: string, isActive: boolean) => void;
  onRefresh: () => void;
}

export function TransformList({
  transforms,
  loading,
  error,
  onToggle,
  onRefresh,
}: TransformListProps) {
  // No auto-refresh needed - data is already loaded when opening settings
  // onRefresh is available for user-triggered refresh via retry button

  if (loading && transforms.length === 0) {
    return (
      <div className={styles.loadingState}>
        Loading saved transforms...
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.errorState}>
        <div className={styles.errorMessage}>{error}</div>
        <button
          onClick={onRefresh}
          className={styles.retryAction}
        >
          Try again
        </button>
      </div>
    );
  }

  if (transforms.length === 0) {
    return (
      <div className={styles.emptyState}>
        <p className={styles.emptyStateText}>No saved transforms yet.</p>
        <p className={styles.emptyStateSubtext}>
          Use the chat to create complex transforms, then save them for later.
        </p>
      </div>
    );
  }

  // Separate active and inactive transforms
  const activeTransforms = transforms.filter((t) => t.is_active);
  const inactiveTransforms = transforms.filter((t) => !t.is_active);

  return (
    <div className={styles.listContainer}>
      {/* Active Transforms Section */}
      {activeTransforms.length > 0 && (
        <div>
          <h3 className={`${styles.sectionHeading} ${styles.sectionHeadingActive}`}>
            <span className={`${styles.statusIndicator} ${styles.statusIndicatorActive}`}></span>
            Active Transforms ({activeTransforms.length})
          </h3>
          <div className={styles.transformCards}>
            {activeTransforms.map((transform) => (
              <TransformCard
                key={transform.id}
                transform={transform}
                onToggle={onToggle}
              />
            ))}
          </div>
        </div>
      )}

      {/* Inactive Transforms Section */}
      {inactiveTransforms.length > 0 && (
        <div>
          <h3 className={`${styles.sectionHeading} ${styles.sectionHeadingInactive}`}>
            <span className={`${styles.statusIndicator} ${styles.statusIndicatorInactive}`}></span>
            Inactive Transforms ({inactiveTransforms.length})
          </h3>
          <div className={styles.transformCards}>
            {inactiveTransforms.map((transform) => (
              <TransformCard
                key={transform.id}
                transform={transform}
                onToggle={onToggle}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Re-export components
export { TransformCard } from "./TransformCard/index";
