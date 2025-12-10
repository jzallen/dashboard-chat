import type { ColumnFiltersState } from "@tanstack/react-table";
import type { Dispatch, SetStateAction } from "react";

interface ActiveFiltersProps {
  columnFilters: ColumnFiltersState;
  setColumnFilters: Dispatch<SetStateAction<ColumnFiltersState>>;
}

export function ActiveFilters({
  columnFilters,
  setColumnFilters,
}: ActiveFiltersProps) {
  if (columnFilters.length === 0) return null;

  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {columnFilters.map((filter) => {
        const filterVal = filter.value as {
          operator: string;
          value: unknown;
        };
        return (
          <span
            key={filter.id}
            className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm"
          >
            {filter.id} {filterVal.operator} {String(filterVal.value)}
            <button
              onClick={() =>
                setColumnFilters((prev) =>
                  prev.filter((f) => f.id !== filter.id)
                )
              }
              className="ml-1 hover:text-blue-600"
            >
              ×
            </button>
          </span>
        );
      })}
      <button
        onClick={() => setColumnFilters([])}
        className="px-3 py-1 text-sm text-gray-600 hover:text-gray-800"
      >
        Clear all
      </button>
    </div>
  );
}
