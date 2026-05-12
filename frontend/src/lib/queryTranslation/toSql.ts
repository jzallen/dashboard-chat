/**
 * RAQB to SQL Conversion
 *
 * Converts RAQB JSON tree format to SQL WHERE clause.
 * Includes SQL injection prevention through proper escaping.
 */

import type { RAQBGroup, RAQBOperator, RAQBRule, RAQBTree, RAQBValueType } from "./types";
import { isRAQBGroup,isRAQBRule } from "./types";

/**
 * Options for SQL generation
 */
export interface ToSqlOptions {
  /** Quote character for identifiers (default: double quote) */
  identifierQuote?: string;
  /** Whether to use parameterized queries (returns placeholders instead of values) */
  parameterized?: boolean;
  /** Starting parameter index for parameterized queries (default: 1) */
  parameterStartIndex?: number;
}

/**
 * Result of SQL generation with parameterized queries
 */
export interface ParameterizedSqlResult {
  /** The SQL WHERE clause with placeholders */
  sql: string;
  /** Array of parameter values in order */
  params: RAQBValueType[];
}

/**
 * Convert a RAQB tree to a SQL WHERE clause
 *
 * @param tree - The RAQB JSON tree to convert
 * @param options - SQL generation options
 * @returns SQL WHERE clause string (without the "WHERE" keyword)
 */
export function raqbToSql(tree: RAQBTree, options: ToSqlOptions = {}): string {
  const { identifierQuote = '"' } = options;

  if (!tree.children1 || Object.keys(tree.children1).length === 0) {
    return "1=1"; // Return always-true condition for empty tree
  }

  return processGroup(tree, identifierQuote);
}

/**
 * Convert a RAQB tree to parameterized SQL
 *
 * @param tree - The RAQB JSON tree to convert
 * @param options - SQL generation options
 * @returns Object with SQL string and parameter values
 */
export function raqbToParameterizedSql(
  tree: RAQBTree,
  options: ToSqlOptions = {}
): ParameterizedSqlResult {
  const { identifierQuote = '"', parameterStartIndex = 1 } = options;

  if (!tree.children1 || Object.keys(tree.children1).length === 0) {
    return { sql: "1=1", params: [] };
  }

  const params: RAQBValueType[] = [];
  let paramIndex = parameterStartIndex;

  const sql = processGroupParameterized(tree, identifierQuote, params, () => paramIndex++);

  return { sql, params };
}

/**
 * Process a RAQB group and generate SQL
 */
function processGroup(group: RAQBGroup, identifierQuote: string): string {
  if (!group.children1) {
    return "1=1";
  }

  const children = Object.values(group.children1);
  if (children.length === 0) {
    return "1=1";
  }

  const conjunction = group.properties.conjunction;
  const parts: string[] = [];

  for (const child of children) {
    if (isRAQBRule(child)) {
      const sql = convertRuleToSql(child, identifierQuote);
      if (sql) {
        parts.push(sql);
      }
    } else if (isRAQBGroup(child)) {
      const nestedSql = processGroup(child, identifierQuote);
      if (nestedSql && nestedSql !== "1=1") {
        // Don't wrap in parentheses if it already starts with NOT (has its own parens)
        if (nestedSql.startsWith("NOT ")) {
          parts.push(nestedSql);
        } else {
          parts.push(`(${nestedSql})`);
        }
      }
    }
  }

  if (parts.length === 0) {
    return "1=1";
  }

  if (parts.length === 1) {
    return parts[0];
  }

  const result = parts.join(` ${conjunction} `);

  // Apply NOT if the group has it
  if (group.properties.not) {
    return `NOT (${result})`;
  }

  return result;
}

/**
 * Process a RAQB group with parameterized queries
 */
function processGroupParameterized(
  group: RAQBGroup,
  identifierQuote: string,
  params: RAQBValueType[],
  getNextParamIndex: () => number
): string {
  if (!group.children1) {
    return "1=1";
  }

  const children = Object.values(group.children1);
  if (children.length === 0) {
    return "1=1";
  }

  const conjunction = group.properties.conjunction;
  const parts: string[] = [];

  for (const child of children) {
    if (isRAQBRule(child)) {
      const sql = convertRuleToParameterizedSql(child, identifierQuote, params, getNextParamIndex);
      if (sql) {
        parts.push(sql);
      }
    } else if (isRAQBGroup(child)) {
      const nestedSql = processGroupParameterized(child, identifierQuote, params, getNextParamIndex);
      if (nestedSql && nestedSql !== "1=1") {
        // Don't wrap in parentheses if it already starts with NOT (has its own parens)
        if (nestedSql.startsWith("NOT ")) {
          parts.push(nestedSql);
        } else {
          parts.push(`(${nestedSql})`);
        }
      }
    }
  }

  if (parts.length === 0) {
    return "1=1";
  }

  if (parts.length === 1) {
    return parts[0];
  }

  const result = parts.join(` ${conjunction} `);

  if (group.properties.not) {
    return `NOT (${result})`;
  }

  return result;
}

/**
 * Convert a single RAQB rule to SQL
 */
function convertRuleToSql(rule: RAQBRule, _identifierQuote: string): string | null {
  const { field, operator, value } = rule.properties;
  const quotedField = escapeIdentifier(field);

  return operatorToSql(quotedField, operator, value);
}

/**
 * Convert a single RAQB rule to parameterized SQL
 */
function convertRuleToParameterizedSql(
  rule: RAQBRule,
  _identifierQuote: string,
  params: RAQBValueType[],
  getNextParamIndex: () => number
): string | null {
  const { field, operator, value } = rule.properties;
  const quotedField = escapeIdentifier(field);

  return operatorToParameterizedSql(quotedField, operator, value, params, getNextParamIndex);
}

/**
 * Generate SQL for a specific operator
 */
function operatorToSql(
  quotedField: string,
  operator: RAQBOperator,
  value: RAQBValueType[]
): string | null {
  switch (operator) {
    case "equal":
    case "select_equals":
      return `${quotedField} = ${escapeValue(value[0])}`;

    case "not_equal":
    case "select_not_equals":
      return `${quotedField} <> ${escapeValue(value[0])}`;

    case "less":
      return `${quotedField} < ${escapeValue(value[0])}`;

    case "less_or_equal":
      return `${quotedField} <= ${escapeValue(value[0])}`;

    case "greater":
      return `${quotedField} > ${escapeValue(value[0])}`;

    case "greater_or_equal":
      return `${quotedField} >= ${escapeValue(value[0])}`;

    case "between":
      if (value.length >= 2) {
        return `${quotedField} BETWEEN ${escapeValue(value[0])} AND ${escapeValue(value[1])}`;
      }
      return null;

    case "not_between":
      if (value.length >= 2) {
        return `${quotedField} NOT BETWEEN ${escapeValue(value[0])} AND ${escapeValue(value[1])}`;
      }
      return null;

    case "like":
      return `${quotedField} ILIKE ${escapeValue(`%${value[0]}%`)}`;

    case "not_like":
      return `${quotedField} NOT ILIKE ${escapeValue(`%${value[0]}%`)}`;

    case "starts_with":
      return `${quotedField} ILIKE ${escapeValue(`${value[0]}%`)}`;

    case "ends_with":
      return `${quotedField} ILIKE ${escapeValue(`%${value[0]}`)}`;

    case "is_null":
      return `${quotedField} IS NULL`;

    case "is_not_null":
      return `${quotedField} IS NOT NULL`;

    case "is_empty":
      return `(${quotedField} IS NULL OR ${quotedField} = '')`;

    case "is_not_empty":
      return `(${quotedField} IS NOT NULL AND ${quotedField} <> '')`;

    case "select_any_in":
      if (value.length > 0) {
        const escapedValues = value.map(escapeValue).join(", ");
        return `${quotedField} IN (${escapedValues})`;
      }
      return null;

    case "select_not_any_in":
      if (value.length > 0) {
        const escapedValues = value.map(escapeValue).join(", ");
        return `${quotedField} NOT IN (${escapedValues})`;
      }
      return null;

    default:
      console.warn(`Unknown RAQB operator: ${operator}`);
      return null;
  }
}

/**
 * Generate parameterized SQL for a specific operator
 */
function operatorToParameterizedSql(
  quotedField: string,
  operator: RAQBOperator,
  value: RAQBValueType[],
  params: RAQBValueType[],
  getNextParamIndex: () => number
): string | null {
  switch (operator) {
    case "equal":
    case "select_equals": {
      const idx = getNextParamIndex();
      params.push(value[0]);
      return `${quotedField} = $${idx}`;
    }

    case "not_equal":
    case "select_not_equals": {
      const idx = getNextParamIndex();
      params.push(value[0]);
      return `${quotedField} <> $${idx}`;
    }

    case "less": {
      const idx = getNextParamIndex();
      params.push(value[0]);
      return `${quotedField} < $${idx}`;
    }

    case "less_or_equal": {
      const idx = getNextParamIndex();
      params.push(value[0]);
      return `${quotedField} <= $${idx}`;
    }

    case "greater": {
      const idx = getNextParamIndex();
      params.push(value[0]);
      return `${quotedField} > $${idx}`;
    }

    case "greater_or_equal": {
      const idx = getNextParamIndex();
      params.push(value[0]);
      return `${quotedField} >= $${idx}`;
    }

    case "between": {
      if (value.length >= 2) {
        const idx1 = getNextParamIndex();
        const idx2 = getNextParamIndex();
        params.push(value[0], value[1]);
        return `${quotedField} BETWEEN $${idx1} AND $${idx2}`;
      }
      return null;
    }

    case "not_between": {
      if (value.length >= 2) {
        const idx1 = getNextParamIndex();
        const idx2 = getNextParamIndex();
        params.push(value[0], value[1]);
        return `${quotedField} NOT BETWEEN $${idx1} AND $${idx2}`;
      }
      return null;
    }

    case "like": {
      const idx = getNextParamIndex();
      params.push(`%${value[0]}%`);
      return `${quotedField} ILIKE $${idx}`;
    }

    case "not_like": {
      const idx = getNextParamIndex();
      params.push(`%${value[0]}%`);
      return `${quotedField} NOT ILIKE $${idx}`;
    }

    case "starts_with": {
      const idx = getNextParamIndex();
      params.push(`${value[0]}%`);
      return `${quotedField} ILIKE $${idx}`;
    }

    case "ends_with": {
      const idx = getNextParamIndex();
      params.push(`%${value[0]}`);
      return `${quotedField} ILIKE $${idx}`;
    }

    case "is_null":
      return `${quotedField} IS NULL`;

    case "is_not_null":
      return `${quotedField} IS NOT NULL`;

    case "is_empty":
      return `(${quotedField} IS NULL OR ${quotedField} = '')`;

    case "is_not_empty":
      return `(${quotedField} IS NOT NULL AND ${quotedField} <> '')`;

    case "select_any_in": {
      if (value.length > 0) {
        const placeholders = value.map(() => `$${getNextParamIndex()}`).join(", ");
        params.push(...value);
        return `${quotedField} IN (${placeholders})`;
      }
      return null;
    }

    case "select_not_any_in": {
      if (value.length > 0) {
        const placeholders = value.map(() => `$${getNextParamIndex()}`).join(", ");
        params.push(...value);
        return `${quotedField} NOT IN (${placeholders})`;
      }
      return null;
    }

    default:
      console.warn(`Unknown RAQB operator: ${operator}`);
      return null;
  }
}

function escapeIdentifier(identifier: string): string {
  return '"' + identifier.replace(/"/g, '""') + '"';
}

/**
 * Escape a SQL value
 * Handles strings, numbers, booleans, and null
 */
function escapeValue(value: RAQBValueType): string {
  if (value === null) {
    return "NULL";
  }

  if (typeof value === "number") {
    // Validate number to prevent NaN/Infinity injection
    if (!Number.isFinite(value)) {
      throw new Error("Invalid numeric value");
    }
    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }

  // String escaping - escape single quotes by doubling them
  const escaped = String(value).replace(/'/g, "''");
  return `'${escaped}'`;
}
