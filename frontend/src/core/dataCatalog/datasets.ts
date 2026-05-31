/**
 * Datasets API — Types
 *
 * Domain functions are provided by createDataCatalog() in ./client.ts.
 * This file exports only types used by the factory and consumers.
 */

import type { RAQBTree } from "@/queryTranslation";

export interface DatasetSparse {
  id: string;
  name: string;
  link: string;
  description: string | null;
  schema_config: SchemaConfig;
  /** MR-6: editable source display name; UI falls back to `name` when null. */
  display_name?: string | null;
}

export interface FieldConfig {
  label: string;
  type: "text" | "number" | "boolean" | "datetime" | "select";
  operators?: string[];
  listValues?: Array<{ value: string; title: string }>;
  nullable?: boolean;
}

export interface SchemaConfig {
  fields: Record<string, FieldConfig>;
}

export type ExpressionConfig =
  | { operation: "trim" }
  | { operation: "case"; mode: string }
  | { operation: "fill_null"; fill_value: unknown }
  | { operation: "map_values"; mappings: Array<{ from: string; to: string }> }
  | { operation: "alias"; alias: string };

export interface Transform {
  id: string;
  name: string;
  description: string | null;
  condition_json: RAQBTree | null;
  condition_sql: string | null;
  status: "enabled" | "disabled" | "deleted";
  transform_type: string;
  target_column: string | null;
  expression_config: ExpressionConfig | null;
  expression_sql: string | null;
  created_at: string;
}

export interface ColumnProfile {
  type: string;
  unique_count?: number;
  sample_values?: string[];
  min?: number | string;
  max?: number | string;
  mean?: number;
  true_count?: number;
  false_count?: number;
  null_count?: number;
}

export interface Dataset {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  schema_config: SchemaConfig;
  partition_fields: string[];
  transforms: Transform[];
  preview_rows: Record<string, unknown>[];
  staging_sql?: string | null;
  column_profiles: Record<string, ColumnProfile> | null;
  format_context?: string | null;
  /** MR-6: editable source display name; UI falls back to `name` when null. */
  display_name?: string | null;
}

export interface DatasetUpdate {
  name?: string;
  description?: string;
  /** MR-6: editable source display name (the filename/`name` stays unchanged). */
  display_name?: string;
}

export interface TransformCreate {
  name: string;
  description?: string;
  condition_json?: RAQBTree;
  condition_sql?: string;
  nl_prompt?: string;
  transform_type?: string;
  target_column?: string;
  expression_config?: Record<string, unknown>;
}

export interface TransformUpdate {
  name?: string;
  description?: string;
  condition_json?: RAQBTree;
  condition_sql?: string;
  status?: "enabled" | "disabled" | "deleted";
}

export interface PreviewSample {
  before: unknown;
  after: unknown;
}

export interface PreviewResponse {
  affected_count: number;
  total_count: number;
  samples: PreviewSample[];
  column: string;
  operation_description: string;
}

export interface PreviewRequest {
  transform_type: string;
  target_column: string;
  expression_config: Record<string, unknown>;
}
