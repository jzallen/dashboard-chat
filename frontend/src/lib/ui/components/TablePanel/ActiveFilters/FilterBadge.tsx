import type { ColumnFilter } from "@tanstack/react-table";
import styles from "./ActiveFilters.module.css";

interface FilterCondition {
  operator: string;
  value: unknown;
}

interface FilterBadgeProps {
  filter: ColumnFilter;
  onRemove: () => void;
}

export function FilterBadge({ filter, onRemove }: FilterBadgeProps) {
  const val = filter.value as Record<string, unknown>;
  const conditions: FilterCondition[] = val.conditions
    ? (val.conditions as FilterCondition[])
    : [{ operator: val.operator as string, value: val.value }];

  const label = conditions
    .map((c) => `${c.operator} ${String(c.value)}`)
    .join(" AND ");

  return (
    <span className={styles.filterBadge}>
      {filter.id} {label}
      <button onClick={onRemove} className={styles.removeButton}>
        ×
      </button>
    </span>
  );
}
