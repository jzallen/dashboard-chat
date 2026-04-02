/**
 * SQL Access API — Types
 */

export interface DatasetSyncStatus {
  dataset_id: string;
  name: string;
  view_name: string;
  sync_status: "synced" | "pending" | "error";
}

export interface SqlAccessStatus {
  project_id: string;
  enabled: boolean;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  schema?: string;
  password?: string;
  last_synced_at?: string;
  created_at?: string;
  connection_string?: string;
  engine_node_id?: string;
  datasets?: DatasetSyncStatus[];
}

// Kept for backward compat in imports — no longer used
export interface EnvironmentStatusResponse {
  project_id: string;
  environment_status: string;
  status_message: string | null;
  pgduckdb_running: boolean;
  pgbouncer_running: boolean;
}
