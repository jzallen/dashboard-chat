/**
 * Utility functions for filter management
 */

import type { ColumnFiltersState } from "@tanstack/react-table";
import type { Transform } from "@/api";
import { isRAQBRule, isRAQBGroup, type RAQBTree } from "@/raqb";

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

/**
 * Return IDs of enabled transforms whose RAQB tree targets the given column.
 */
export function getTransformIdsForColumn(transforms: Transform[], column: string): string[] {
  return transforms
    .filter((t) => t.status === "enabled" && transformTargetsColumn(t.condition_json, column))
    .map((t) => t.id);
}

function transformTargetsColumn(tree: RAQBTree, column: string): boolean {
  if (!tree.children1) return false;
  for (const child of Object.values(tree.children1)) {
    if (isRAQBRule(child) && child.properties.field === column) return true;
    if (isRAQBGroup(child) && transformTargetsColumn(child, column)) return true;
  }
  return false;
}
