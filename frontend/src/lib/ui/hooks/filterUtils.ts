/**
 * Utility functions for filter management
 */

import type { ColumnFiltersState } from "@tanstack/react-table";

interface FilterCondition {
  operator: string;
  value: unknown;
  transformId?: string;
}

/**
 * Normalize a filter value to an array of conditions.
 * Handles both single `{ operator, value }` and compound `{ conditions: [...] }` formats.
 */
export function toConditions(value: unknown): FilterCondition[] {
  const v = value as Record<string, unknown>;
  if (v.conditions && Array.isArray(v.conditions)) {
    return v.conditions as FilterCondition[];
  }
  return [{ operator: v.operator as string, value: v.value, transformId: v.transformId as string | undefined }];
}

/**
 * Merge new filters with existing filters by column ID.
 * If a filter for the same column exists, conditions are merged (AND logic).
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
      // Merge conditions from both filters
      const existingConditions = toConditions(merged[existingIndex].value);
      const newConditions = toConditions(newFilter.value);
      merged[existingIndex] = {
        id: newFilter.id,
        value: { conditions: [...existingConditions, ...newConditions] },
      };
    } else {
      merged.push(newFilter);
    }
  }

  return merged;
}
