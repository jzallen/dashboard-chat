/**
 * RAQB (React Awesome Query Builder) TypeScript Types
 *
 * These types define the canonical intermediate format used for filter translation.
 * RAQB JSON can be:
 * 1. Generated from natural language via LLM
 * 2. Converted to TanStack filter actions (frontend)
 * 3. Converted to SQL WHERE clauses (backend)
 */

/**
 * Supported RAQB operators mapped to their SQL and TanStack equivalents
 */
export type RAQBOperator =
  | "equal"
  | "not_equal"
  | "less"
  | "less_or_equal"
  | "greater"
  | "greater_or_equal"
  | "between"
  | "not_between"
  | "like"
  | "not_like"
  | "starts_with"
  | "ends_with"
  | "is_null"
  | "is_not_null"
  | "is_empty"
  | "is_not_empty"
  | "select_equals"
  | "select_not_equals"
  | "select_any_in"
  | "select_not_any_in";

/**
 * Conjunction types for combining rules within a group
 */
export type RAQBConjunction = "AND" | "OR";

/**
 * Supported field types for schema inference
 */
export type RAQBFieldType =
  | "text"
  | "number"
  | "boolean"
  | "datetime"
  | "date"
  | "time"
  | "select"
  | "multiselect";

/**
 * Value types supported in RAQB rules
 */
export type RAQBValueType = string | number | boolean | null;

/**
 * Value source indicates where the value comes from
 */
export type RAQBValueSrc = "value" | "field" | "func";

/**
 * Properties of a single filter rule
 */
export interface RAQBRuleProperties {
  /** The field/column name being filtered */
  field: string;
  /** The comparison operator */
  operator: RAQBOperator;
  /** Array of values for the filter (supports multi-value operators like "between") */
  value: RAQBValueType[];
  /** Type of each value in the value array */
  valueType?: RAQBFieldType[];
  /** Source of each value */
  valueSrc?: RAQBValueSrc[];
}

/**
 * A single filter rule in the RAQB tree
 */
export interface RAQBRule {
  type: "rule";
  id?: string;
  properties: RAQBRuleProperties;
}

/**
 * Properties of a group node
 */
export interface RAQBGroupProperties {
  /** How rules in this group are combined */
  conjunction: RAQBConjunction;
  /** Whether this group's result is negated */
  not?: boolean;
}

/**
 * A group node that contains rules and/or nested groups
 */
export interface RAQBGroup {
  type: "group";
  id?: string;
  properties: RAQBGroupProperties;
  /** Child nodes - either rules or nested groups */
  children1?: Record<string, RAQBRule | RAQBGroup>;
}

/**
 * The root RAQB tree structure
 * Always starts with a group node
 */
export type RAQBTree = RAQBGroup;

/**
 * Field configuration for schema definition
 */
export interface RAQBFieldConfig {
  /** Display label for the field */
  label: string;
  /** Data type of the field */
  type: RAQBFieldType;
  /** Available operators for this field type */
  operators?: RAQBOperator[];
  /** For select/multiselect fields: list of allowed values */
  listValues?: Array<{ value: string; title: string }>;
  /** Default value for the field */
  defaultValue?: RAQBValueType;
  /** Whether the field can be null */
  nullable?: boolean;
}

/**
 * Schema configuration mapping field names to their configs
 */
export interface RAQBSchemaConfig {
  fields: Record<string, RAQBFieldConfig>;
}

/**
 * Helper type to check if a node is a rule
 */
export function isRAQBRule(node: RAQBRule | RAQBGroup): node is RAQBRule {
  return node.type === "rule";
}

/**
 * Helper type to check if a node is a group
 */
export function isRAQBGroup(node: RAQBRule | RAQBGroup): node is RAQBGroup {
  return node.type === "group";
}
