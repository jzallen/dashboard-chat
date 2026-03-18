/**
 * Views API — Types
 *
 * Domain functions are provided by createDataCatalog() in ./client.ts.
 * This file exports only types used by the factory and consumers.
 */

export interface View {
  id: string;
  project_id: string;
  org_id: string;
  name: string;
  description: string | null;
  sql_definition: string;
  source_refs: Array<{ id: string; type: "dataset" | "view" }>;
  materialization: "ephemeral" | "view" | "table" | "incremental";
  created_at: string | null;
  updated_at: string | null;
}

export interface ViewCreate {
  name: string;
  description?: string;
  sql_definition: string;
  source_refs?: Array<{ id: string; type: "dataset" | "view" }>;
  materialization?: "ephemeral" | "view" | "table" | "incremental";
}

export interface ViewUpdate {
  name?: string;
  description?: string;
  sql_definition?: string;
  source_refs?: Array<{ id: string; type: "dataset" | "view" }>;
  materialization?: "ephemeral" | "view" | "table" | "incremental";
}
