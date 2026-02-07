import type { ColumnFilter } from "@tanstack/react-table";
import styles from "./ActiveFilters.module.css";

interface FilterValue {
  operator: string;
  value: unknown;
}

interface FilterBadgeProps {
  filter: ColumnFilter;
  onRemove: () => void;
}

export function FilterBadge({ filter, onRemove }: FilterBadgeProps) {
  const filterVal = filter.value as FilterValue;

  return (
    <span className={styles.filterBadge}>
      {filter.id} {filterVal.operator} {String(filterVal.value)}
      <button onClick={onRemove} className={styles.removeButton}>
        ×
      </button>
    </span>
  );
}
