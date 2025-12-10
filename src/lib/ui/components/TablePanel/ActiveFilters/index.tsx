import type { ColumnFiltersState } from "@tanstack/react-table";
import type { Dispatch, SetStateAction } from "react";
import { FilterBadge } from "./FilterBadge";
import { ClearAllButton } from "./ClearAllButton";

interface ActiveFiltersProps {
  columnFilters: ColumnFiltersState;
  setColumnFilters: Dispatch<SetStateAction<ColumnFiltersState>>;
}

export default function ActiveFilters({
  columnFilters,
  setColumnFilters,
}: ActiveFiltersProps) {
  if (columnFilters.length === 0) return null;

  const removeFilter = (filterId: string) => {
    setColumnFilters((prev) => prev.filter((f) => f.id !== filterId));
  };

  const clearAllFilters = () => {
    setColumnFilters([]);
  };

  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {columnFilters.map((filter) => (
        <FilterBadge
          key={filter.id}
          filter={filter}
          onRemove={() => removeFilter(filter.id)}
        />
      ))}
      <ClearAllButton onClick={clearAllFilters} />
    </div>
  );
}
