import styles from "./Pagination.module.css";

interface PageIndicatorProps {
  currentPage: number;
  totalPages: number;
}

export function PageIndicator({ currentPage, totalPages }: PageIndicatorProps) {
  return (
    <span className={styles.pageIndicator}>
      Page {currentPage} of {totalPages}
    </span>
  );
}
