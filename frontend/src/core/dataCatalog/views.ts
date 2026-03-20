/**
 * Views API — Types
 *
 * Domain functions are provided by createDataCatalog() in ./client.ts.
 * This file exports only types used by the factory and consumers.
 */

export type DisplayType =
  | "text"
  | "category"
  | "id"
  | "serial"
  | "integer"
  | "decimal"
  | "boolean"
  | "date"
  | "time"
  | "datetime";

export type GrainRole = "Time" | "Dimension" | "Entity" | "Metric";

export interface ViewColumn {
  name: string;
  source_ref: string;
  source_column: string;
  display_type: DisplayType;
  grain_role: GrainRole | null;
  alias: string | null;
}

export interface ViewJoin {
  left_ref: string;
  left_column: string;
  right_ref: string;
  right_column: string;
  join_type: string;
}

export interface ViewFilter {
  source_ref: string;
  column: string;
  operator: string;
  value: string | null;
}

export interface ViewGrain {
  time_column: string;
  dimensions: string[];
}

export interface View {
  id: string;
  project_id: string;
  org_id: string;
  name: string;
  description: string | null;
  sql_definition: string;
  display_sql?: string;
  source_refs: Array<{ id: string; type: "dataset" | "view" }>;
  columns: ViewColumn[];
  joins: ViewJoin[];
  filters: ViewFilter[];
  grain: ViewGrain | null;
  materialization: "ephemeral" | "view" | "table" | "incremental";
  created_at: string | null;
  updated_at: string | null;
}

export interface ViewCreate {
  name: string;
  description?: string;
  sql_definition?: string;
  source_refs?: Array<{ id: string; type: "dataset" | "view" }>;
  columns?: ViewColumn[];
  joins?: ViewJoin[];
  filters?: ViewFilter[];
  grain?: ViewGrain | null;
  materialization?: "ephemeral" | "view" | "table" | "incremental";
}

export interface ViewUpdate {
  name?: string;
  description?: string;
  sql_definition?: string;
  source_refs?: Array<{ id: string; type: "dataset" | "view" }>;
  columns?: ViewColumn[];
  joins?: ViewJoin[];
  filters?: ViewFilter[];
  grain?: ViewGrain | null;
  materialization?: "ephemeral" | "view" | "table" | "incremental";
}
