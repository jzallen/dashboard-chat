/**
 * Operator Mapping between RAQB and TanStack Table
 *
 * Maps RAQB operators to their TanStack equivalents for frontend filtering.
 */

import type { RAQBOperator } from "./types";

/**
 * TanStack filter operators supported by customFilterFn
 */
export type TanStackOperator =
  | "equals"
  | "notEquals"
  | "contains"
  | "gt"
  | "lt"
  | "gte"
  | "lte";

/**
 * Mapping from RAQB operators to TanStack operators
 * Some RAQB operators map to the same TanStack operator with different value handling
 */
export const RAQB_TO_TANSTACK_OPERATOR: Record<RAQBOperator, TanStackOperator | null> = {
  // Equality operators
  equal: "equals",
  not_equal: "notEquals",
  select_equals: "equals",
  select_not_equals: "notEquals",

  // Comparison operators
  less: "lt",
  less_or_equal: "lte",
  greater: "gt",
  greater_or_equal: "gte",

  // String operators
  like: "contains",
  not_like: "notEquals", // Approximation - TanStack doesn't have notContains
  starts_with: "contains", // Will be handled with value prefix matching
  ends_with: "contains", // Will be handled with value suffix matching

  // Range operators - need special handling
  between: null, // Requires decomposition into gte + lte
  not_between: null, // Requires decomposition into lt OR gt

  // Null checks - need special handling
  is_null: null,
  is_not_null: null,
  is_empty: null,
  is_not_empty: null,

  // Multi-select - need special handling
  select_any_in: null,
  select_not_any_in: null,
};

/**
 * Check if an operator requires special handling (cannot be directly mapped)
 */
export function requiresSpecialHandling(operator: RAQBOperator): boolean {
  return RAQB_TO_TANSTACK_OPERATOR[operator] === null;
}

/**
 * Get the TanStack operator for a given RAQB operator
 * Returns null if the operator requires special handling
 */
export function mapOperator(operator: RAQBOperator): TanStackOperator | null {
  return RAQB_TO_TANSTACK_OPERATOR[operator];
}

/**
 * Operators that work on numeric values
 */
export const NUMERIC_OPERATORS: RAQBOperator[] = [
  "equal",
  "not_equal",
  "less",
  "less_or_equal",
  "greater",
  "greater_or_equal",
  "between",
  "not_between",
];

/**
 * Operators that work on string values
 */
export const STRING_OPERATORS: RAQBOperator[] = [
  "equal",
  "not_equal",
  "like",
  "not_like",
  "starts_with",
  "ends_with",
  "is_empty",
  "is_not_empty",
];

/**
 * Operators that work on boolean values
 */
export const BOOLEAN_OPERATORS: RAQBOperator[] = ["equal", "not_equal"];

/**
 * Operators that work on select/enum values
 */
export const SELECT_OPERATORS: RAQBOperator[] = [
  "select_equals",
  "select_not_equals",
  "select_any_in",
  "select_not_any_in",
];
