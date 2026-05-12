import type { ColumnFiltersState } from "@tanstack/react-table";
import { type Dispatch, type SetStateAction, useCallback } from "react";

import { toConditions } from "../../../hooks/filterUtils";
import styles from "./ActiveFilters.module.css";
import { FilterBadge } from "./FilterBadge";

interface ActiveFiltersProps {
  columnFilters: ColumnFiltersState;
  setColumnFilters: Dispatch<SetStateAction<ColumnFiltersState>>;
  onToggleTransform?: (transformId: string, isActive: boolean) => void;
}

/** Displays active column filters as removable badges above the table. */
export default function ActiveFilters({
  columnFilters,
  setColumnFilters,
  onToggleTransform,
}: ActiveFiltersProps) {
  const removeFilter = useCallback(
    (filterId: string, filterValue: unknown) => {
      const conditions = toConditions(filterValue);

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
    },
    [onToggleTransform, setColumnFilters]
  );

  if (columnFilters.length === 0) return null;

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
