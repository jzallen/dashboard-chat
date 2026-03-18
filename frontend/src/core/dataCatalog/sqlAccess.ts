/**
 * SQL Access API — Types
 *
 * Domain functions are provided by createDataCatalog() in ./client.ts.
 * This file exports only types used by the factory and consumers.
 */

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
  environment_status?: string;
  status_message?: string | null;
  is_legacy?: boolean;
}

export interface EnvironmentStatusResponse {
  project_id: string;
  environment_status: string;
  status_message: string | null;
  pgduckdb_running: boolean;
  pgbouncer_running: boolean;
}
