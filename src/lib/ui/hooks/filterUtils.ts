/**
 * Utility functions for filter management
 */

import type { ColumnFiltersState } from "@tanstack/react-table";

/**
 * Merge new filters with existing filters by column ID.
 * If a filter for the same column exists, it will be replaced.
 * Otherwise, the new filter is added.
 */
export function mergeFilters(
  existingFilters: ColumnFiltersState,
  newFilters: ColumnFiltersState
): ColumnFiltersState {
  const merged = [...existingFilters];

  for (const newFilter of newFilters) {
    const existingIndex = merged.findIndex((f) => f.id === newFilter.id);
    if (existingIndex >= 0) {
      // Replace filter for the same column
      merged[existingIndex] = newFilter;
    } else {
      // Add new filter
      merged.push(newFilter);
    }
  }

  return merged;
}
