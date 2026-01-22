/**
 * Converts TanStack-style filter operations to RAQB JSON format for persistence.
 */

import type { RAQBTree, RAQBOperator } from "@/raqb";

interface FilterTableArgs {
  column: string;
  operator: string;
  value: unknown;
}

/**
 * Maps TanStack/simple operators to RAQB operators
 */
const OPERATOR_MAP: Record<string, RAQBOperator> = {
  // Equality
  equals: "equal",
  notEquals: "not_equal",

  // Numeric comparisons
  gt: "greater",
  gte: "greater_or_equal",
  lt: "less",
  lte: "less_or_equal",
  between: "between",

  // String operations
  contains: "like",
  startsWith: "starts_with",
  endsWith: "ends_with",

  // Null checks
  isNull: "is_null",
  isNotNull: "is_not_null",

  // Select operations
  selectEquals: "select_equals",
  selectAnyIn: "select_any_in",
};

/**
 * Converts a filterTable tool call to RAQB tree format
 */
export function filterTableToRaqb(args: FilterTableArgs): RAQBTree {
  const raqbOperator = OPERATOR_MAP[args.operator] || "equal";

  // Normalize value to array format (RAQB expects arrays)
  const valueArray = Array.isArray(args.value) ? args.value : [args.value];

  return {
    type: "group",
    properties: {
      conjunction: "AND",
    },
    children1: {
      rule_1: {
        type: "rule",
        properties: {
          field: args.column,
          operator: raqbOperator,
          value: valueArray,
        },
      },
    },
  };
}

/**
 * Generates a human-readable description for a filter
 */
export function generateFilterDescription(args: FilterTableArgs): string {
  const operatorDescriptions: Record<string, string> = {
    equals: "equals",
    notEquals: "does not equal",
    gt: "is greater than",
    gte: "is at least",
    lt: "is less than",
    lte: "is at most",
    between: "is between",
    contains: "contains",
    startsWith: "starts with",
    endsWith: "ends with",
    isNull: "is empty",
    isNotNull: "is not empty",
  };

  const opDesc = operatorDescriptions[args.operator] || args.operator;
  const valueStr = Array.isArray(args.value)
    ? args.value.join(" and ")
    : String(args.value);

  return `${args.column} ${opDesc} ${valueStr}`;
}
