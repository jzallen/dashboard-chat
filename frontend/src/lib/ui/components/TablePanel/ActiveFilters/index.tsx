import type { ColumnFiltersState } from "@tanstack/react-table";
import type { Dispatch, SetStateAction } from "react";
import { FilterBadge } from "./FilterBadge";
import { toConditions } from "../../../hooks/filterUtils";
import styles from "./ActiveFilters.module.css";

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
    const conditions = toConditions(filterValue);

    // Deactivate any transforms linked to conditions in this filter
    const transformIds = conditions
      .map((c) => c.transformId)
      .filter((id): id is string => Boolean(id));

    if (transformIds.length > 0 && onToggleTransform) {
      for (const id of transformIds) {
        onToggleTransform(id, false);
      }
    } else {
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
