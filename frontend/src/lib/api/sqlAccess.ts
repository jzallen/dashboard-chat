/**
 * SQL Access API
 */

import { get, post, del } from "./client";

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
  connection_string?: string;
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
