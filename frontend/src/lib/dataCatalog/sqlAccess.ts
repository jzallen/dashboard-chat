/**
 * SQL Access API
 */

import { del,get, post } from "./client";

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

/**
 * Enable SQL access for a project
 */
export async function enableSqlAccess(
  projectId: string
): Promise<SqlAccessStatus> {
  return post<SqlAccessStatus>(
    `/api/projects/${projectId}/sql-access`,
    {}
  );
}

/**
 * Disable SQL access for a project
 */
export async function disableSqlAccess(projectId: string): Promise<void> {
  return del(`/api/projects/${projectId}/sql-access`);
}

/**
 * Get SQL access status for a project
 */
export async function getSqlAccess(
  projectId: string
): Promise<SqlAccessStatus> {
  return get<SqlAccessStatus>(`/api/projects/${projectId}/sql-access`);
}

/**
 * Sync SQL access data for a project
 */
export async function syncSqlAccess(
  projectId: string
): Promise<SqlAccessStatus> {
  return post<SqlAccessStatus>(
    `/api/projects/${projectId}/sql-access/sync`,
    {}
  );
}

/**
 * Regenerate SQL access credentials for a project
 */
export async function regenerateSqlCredentials(
  projectId: string
): Promise<SqlAccessStatus> {
  return post<SqlAccessStatus>(
    `/api/projects/${projectId}/sql-access/credentials`,
    {}
  );
}

/**
 * Start the SQL access environment for a project
 */
export async function startEnvironment(
  projectId: string
): Promise<SqlAccessStatus> {
  return post<SqlAccessStatus>(
    `/api/projects/${projectId}/sql-access/environment/start`,
    {}
  );
}

/**
 * Stop the SQL access environment for a project
 */
export async function stopEnvironment(
  projectId: string
): Promise<SqlAccessStatus> {
  return post<SqlAccessStatus>(
    `/api/projects/${projectId}/sql-access/environment/stop`,
    {}
  );
}

/**
 * Restart the SQL access environment for a project
 */
export async function restartEnvironment(
  projectId: string
): Promise<SqlAccessStatus> {
  return post<SqlAccessStatus>(
    `/api/projects/${projectId}/sql-access/environment/restart`,
    {}
  );
}

/**
 * Get the environment status for a project
 */
export async function getEnvironmentStatus(
  projectId: string
): Promise<EnvironmentStatusResponse> {
  return get<EnvironmentStatusResponse>(
    `/api/projects/${projectId}/sql-access/environment/status`
  );
}
