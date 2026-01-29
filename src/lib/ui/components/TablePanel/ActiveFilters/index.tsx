import type { ColumnFiltersState } from "@tanstack/react-table";
import type { Dispatch, SetStateAction } from "react";
import { FilterBadge } from "./FilterBadge";
import styles from "./ActiveFilters.module.css";

interface FilterValue {
  operator: string;
  value: unknown;
  transformId?: string;
}

interface ActiveFiltersProps {
  columnFilters: ColumnFiltersState;
  setColumnFilters: Dispatch<SetStateAction<ColumnFiltersState>>;
  onToggleTransform?: (transformId: string, isActive: boolean) => void;
}

export default function ActiveFilters({
  columnFilters,
  setColumnFilters,
  onToggleTransform,
}: ActiveFiltersProps) {
  if (columnFilters.length === 0) return null;

  const removeFilter = (filterId: string, filterValue: unknown) => {
    const value = filterValue as FilterValue;

    // If this filter has a transformId, deactivate the transform via API
    if (value.transformId && onToggleTransform) {
      onToggleTransform(value.transformId, false);
    } else {
      // Fallback: just remove from local state (for filters without transforms)
      setColumnFilters((prev) => prev.filter((f) => f.id !== filterId));
    }
  };

  return (
    <div className={styles.filtersContainer}>
      {columnFilters.map((filter) => (
        <FilterBadge
          key={filter.id}
          filter={filter}
          onRemove={() => removeFilter(filter.id, filter.value)}
        />
      ))}
    </div>
  );
}
