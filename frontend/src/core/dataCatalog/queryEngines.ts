/**
 * Query Engine API — Types
 */

export interface QueryEngineNode {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
  status: string;
  status_message: string | null;
  project_count?: number;
  created_at: string;
  updated_at?: string;
}

export interface QueryEngineDetail extends QueryEngineNode {
  connected_projects?: Array<{
    project_id: string;
    project_name: string;
    schema_name: string;
    sync_status: string;
    last_synced_at: string | null;
  }>;
}

export interface QueryEngineTestResult {
  success: boolean;
  latency_ms: number;
  error?: string;
}
