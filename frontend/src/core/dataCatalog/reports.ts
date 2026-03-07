/**
 * Reports API — Types
 *
 * Domain functions are provided by createDataCatalog() in ./client.ts.
 * This file exports only types used by the factory and consumers.
 */

export interface ColumnMetadata {
  name: string;
  semantic_role: "entity" | "dimension" | "measure";
  semantic_type: string;
  description?: string;
  expr?: string;
  time_granularity?: string;
}

export interface Report {
  id: string;
  project_id: string;
  org_id: string;
  name: string;
  description: string | null;
  sql_definition: string;
  report_type: "fact" | "dimension";
  source_refs: Array<{ id: string; type: "dataset" | "view" }>;
  domain: string;
  columns_metadata: ColumnMetadata[];
  materialization: "ephemeral" | "view" | "table" | "incremental";
  created_at: string | null;
  updated_at: string | null;
}

export interface ReportCreate {
  name: string;
  description?: string;
  sql_definition: string;
  report_type: "fact" | "dimension";
  source_refs?: Array<{ id: string; type: "dataset" | "view" }>;
  domain: string;
  columns_metadata?: ColumnMetadata[];
  materialization?: "ephemeral" | "view" | "table" | "incremental";
}

export interface ReportUpdate {
  name?: string;
  description?: string;
  sql_definition?: string;
  report_type?: "fact" | "dimension";
  source_refs?: Array<{ id: string; type: "dataset" | "view" }>;
  domain?: string;
  columns_metadata?: ColumnMetadata[];
  materialization?: "ephemeral" | "view" | "table" | "incremental";
}
