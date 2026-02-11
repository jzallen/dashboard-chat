/**
 * RAQB to TanStack Conversion
 *
 * Converts RAQB JSON tree format to TanStack Table columnFilters.
 * Handles nested groups by flattening into individual filter entries.
 */

import type { ColumnFiltersState } from "@tanstack/react-table";
import type { RAQBTree, RAQBGroup, RAQBRule, RAQBOperator, RAQBValueType } from "./types";
import { isRAQBRule, isRAQBGroup } from "./types";
import { mapOperator, type TanStackOperator } from "./operators";

/**
 * TanStack filter value structure used by customFilterFn
 */
export interface TanStackFilterValue {
  operator: TanStackOperator;
  value: unknown;
  transformId?: string;
}

/**
 * Extended filter entry that preserves RAQB context
 */
export interface ExtendedColumnFilter {
  id: string;
  value: TanStackFilterValue;
  /** Original RAQB operator for display purposes */
  raqbOperator?: RAQBOperator;
  /** Group conjunction context (for complex filters) */
  conjunction?: "AND" | "OR";
}

/**
 * Options for converting RAQB tree to TanStack filters
 */
export interface RaqbToTanstackOptions {
  /** Transform ID to embed in each filter value */
  transformId?: string;
}

/**
 * Convert a RAQB tree to TanStack columnFilters state
 *
 * Note: TanStack Table applies filters with AND logic by default.
 * OR groups within RAQB are flattened and the OR semantics may be lost
 * unless custom filter logic handles it.
 *
 * @param raqbTree - The RAQB JSON tree to convert
 * @param options - Optional configuration including transformId
 * @returns TanStack columnFilters state array
 */
export function raqbToTanstackFilters(
  raqbTree: RAQBTree,
  options?: RaqbToTanstackOptions
): ColumnFiltersState {
  const filters: ColumnFiltersState = [];

  processGroup(raqbTree, filters, options?.transformId);

  return filters;
}

/**
 * Convert RAQB tree and preserve additional metadata
 */
export function raqbToExtendedFilters(raqbTree: RAQBTree): ExtendedColumnFilter[] {
  const filters: ExtendedColumnFilter[] = [];

  processGroupExtended(raqbTree, filters, raqbTree.properties?.conjunction ?? "AND");

  return filters;
}

/**
 * Process a RAQB group and add its rules to the filters array
 */
function processGroup(
  group: RAQBGroup,
  filters: ColumnFiltersState,
  transformId?: string
): void {
  if (!group.children1) {
    return;
  }

  for (const child of Object.values(group.children1)) {
    if (isRAQBRule(child)) {
      const converted = convertRule(child, transformId);
      if (converted) {
        filters.push(converted);
      }
    } else if (isRAQBGroup(child)) {
      // Recursively process nested groups
      processGroup(child, filters, transformId);
    }
  }
}

/**
 * Process a RAQB group with extended metadata
 */
function processGroupExtended(
  group: RAQBGroup,
  filters: ExtendedColumnFilter[],
  parentConjunction: "AND" | "OR"
): void {
  if (!group.children1) {
    return;
  }

  const conjunction = group.properties?.conjunction ?? "AND";

  for (const child of Object.values(group.children1)) {
    if (isRAQBRule(child)) {
      const converted = convertRuleExtended(child, conjunction);
      if (converted) {
        filters.push(converted);
      }
    } else if (isRAQBGroup(child)) {
      processGroupExtended(child, filters, conjunction);
    }
  }
}

/**
 * Convert a single RAQB rule to TanStack filter format
 */
function convertRule(
  rule: RAQBRule,
  transformId?: string
): { id: string; value: TanStackFilterValue } | null {
  const { field, operator, value } = rule.properties;

  // Handle special operators that need decomposition
  const specialResult = handleSpecialOperator(field, operator, value, transformId);
  if (specialResult) {
    // For now, return the first filter (special operators may need multiple filters)
    return specialResult[0] || null;
  }

  const tanstackOperator = mapOperator(operator);
  if (!tanstackOperator) {
    // Operator not supported in TanStack
    console.warn(`RAQB operator "${operator}" not supported in TanStack conversion`);
    return null;
  }

  return {
    id: field,
    value: {
      operator: tanstackOperator,
      value: value[0],
      transformId,
    },
  };
}

/**
 * Convert a single RAQB rule with extended metadata
 */
function convertRuleExtended(
  rule: RAQBRule,
  conjunction: "AND" | "OR"
): ExtendedColumnFilter | null {
  const { field, operator, value } = rule.properties;

  // Handle special operators
  const specialResult = handleSpecialOperatorExtended(field, operator, value, conjunction);
  if (specialResult) {
    return specialResult[0] || null;
  }

  const tanstackOperator = mapOperator(operator);
  if (!tanstackOperator) {
    console.warn(`RAQB operator "${operator}" not supported in TanStack conversion`);
    return null;
  }

  return {
    id: field,
    value: {
      operator: tanstackOperator,
      value: value[0],
    },
    raqbOperator: operator,
    conjunction,
  };
}

/**
 * Handle operators that require special logic
 * Returns an array of filters (some operators decompose into multiple)
 */
function handleSpecialOperator(
  field: string,
  operator: RAQBOperator,
  value: RAQBValueType[],
  transformId?: string
): Array<{ id: string; value: TanStackFilterValue }> | null {
  switch (operator) {
    case "between":
      // Compound filter: both conditions on the same column (AND)
      if (value.length >= 2) {
        return [{
          id: field,
          value: {
            conditions: [
              { operator: "gte", value: value[0], transformId },
              { operator: "lte", value: value[1], transformId },
            ],
          } as unknown as TanStackFilterValue,
        }];
      }
      return null;

    case "not_between":
      // This is tricky - would need OR logic (< min OR > max)
      // For now, we approximate with just the first condition
      if (value.length >= 2) {
        return [{ id: field, value: { operator: "lt", value: value[0], transformId } }];
      }
      return null;

    case "is_null":
    case "is_empty":
      return [{ id: field, value: { operator: "equals", value: "", transformId } }];

    case "is_not_null":
    case "is_not_empty":
      return [{ id: field, value: { operator: "notEquals", value: "", transformId } }];

    case "select_any_in":
      // For multi-select, we'd need custom filter logic
      // For now, match the first value
      if (value.length > 0) {
        return [{ id: field, value: { operator: "equals", value: value[0], transformId } }];
      }
      return null;

    case "select_not_any_in":
      if (value.length > 0) {
        return [{ id: field, value: { operator: "notEquals", value: value[0], transformId } }];
      }
      return null;

    default:
      return null;
  }
}

/**
 * Handle special operators with extended metadata
 */
function handleSpecialOperatorExtended(
  field: string,
  operator: RAQBOperator,
  value: RAQBValueType[],
  conjunction: "AND" | "OR"
): ExtendedColumnFilter[] | null {
  const basicResult = handleSpecialOperator(field, operator, value);
  if (!basicResult) {
    return null;
  }

  return basicResult.map((filter) => ({
    ...filter,
    raqbOperator: operator,
    conjunction,
  }));
}

/**
 * Check if a RAQB tree is empty (has no rules)
 */
export function isEmptyTree(tree: RAQBTree): boolean {
  if (!tree.children1) {
    return true;
  }

  const children = Object.values(tree.children1);
  if (children.length === 0) {
    return true;
  }

  // Check if all children are empty groups
  return children.every((child) => {
    if (isRAQBRule(child)) {
      return false;
    }
    if (isRAQBGroup(child)) {
      return isEmptyTree(child);
    }
    return true;
  });
}

/**
 * Count the number of rules in a RAQB tree
 */
export function countRules(tree: RAQBTree): number {
  let count = 0;

  function countInGroup(group: RAQBGroup): void {
    if (!group.children1) {
      return;
    }

    for (const child of Object.values(group.children1)) {
      if (isRAQBRule(child)) {
        count++;
      } else if (isRAQBGroup(child)) {
        countInGroup(child);
      }
    }
  }

  countInGroup(tree);
  return count;
}
