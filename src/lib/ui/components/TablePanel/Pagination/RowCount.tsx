import styles from "./Pagination.module.css";

interface RowCountProps {
  visibleCount: number;
  totalCount: number;
}

export function RowCount({ visibleCount, totalCount }: RowCountProps) {
  return (
    <div className={styles.rowCount}>
      Showing {visibleCount} of {totalCount} rows
    </div>
  );
}
