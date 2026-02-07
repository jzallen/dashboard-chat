/**
 * Skeleton loaders for various panels
 */

import styles from "./SkeletonLoader.module.css";

export function ProjectViewSkeleton() {
  return (
    <div className={styles.skeletonContainer}>
      {/* Header skeleton */}
      <div className={styles.headerSkeleton}>
        <div className={styles.headerTitleBar}></div>
      </div>

      {/* Dataset cards skeleton */}
      <div className={styles.cardsContainer}>
        {[1, 2, 3].map((i) => (
          <div key={i} className={styles.cardSkeleton}>
            <div className={styles.cardTitleBar}></div>
            <div className={styles.cardDescriptionBar}></div>
            <div className={styles.cardMetaBar}></div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TablePanelSkeleton() {
  return (
    <div className={styles.skeletonContainer}>
      {/* Header skeleton */}
      <div className={styles.headerSkeleton}>
        <div className={styles.headerTitleBar}></div>
      </div>

      {/* Active filters skeleton */}
      <div className={styles.filtersSkeleton}>
        <div className={styles.filterPillsContainer}>
          <div className={`${styles.filterPill} ${styles.filterPillSmall}`}></div>
          <div className={`${styles.filterPill} ${styles.filterPillMedium}`}></div>
        </div>
      </div>

      {/* Table skeleton */}
      <div className={styles.tableArea}>
        <div className={styles.tableContainer}>
          {/* Table header */}
          <div className={styles.tableHeader}>
            <div className={styles.headerRow}>
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className={styles.headerCell}>
                  <div className={styles.headerText}></div>
                </div>
              ))}
            </div>
          </div>

          {/* Table rows */}
          <div className={styles.tableBody}>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((row) => (
              <div key={row} className={styles.tableRow}>
                {[1, 2, 3, 4, 5].map((col) => (
                  <div key={col} className={styles.tableCell}>
                    <div className={styles.cellContent}></div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Pagination skeleton */}
      <div className={styles.paginationSkeleton}>
        <div className={styles.paginationLayout}>
          <div className={`${styles.paginationText} ${styles.paginationTextLeft}`}></div>
          <div className={styles.paginationButtons}>
            <div className={styles.paginationButton}></div>
            <div className={styles.paginationButton}></div>
          </div>
          <div className={`${styles.paginationText} ${styles.paginationTextRight}`}></div>
        </div>
      </div>
    </div>
  );
}
