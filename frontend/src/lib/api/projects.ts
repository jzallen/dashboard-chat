/**
 * Projects API
 */

import { API_BASE_URL,get } from "./client";
import type { DatasetSparse } from "./datasets";
import { getAuthHeaders, withAuthRetry } from "./fetchUtils";

export type { DatasetSparse } from "./datasets";

export interface Project {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  datasets?: DatasetSparse[];
}

/**
 * List all projects for the current user's org
 */
export async function listProjects(): Promise<Project[]> {
  return get<Project[]>("/api/projects");
}

/**
 * Get a single project by ID
 */
export async function getProject(projectId: string): Promise<Project> {
  return get<Project>(`/api/projects/${projectId}`);
}

/**
 * Download a dbt project export as a zip file
 */
export async function exportDbtProject(projectId: string): Promise<void> {
  const url = `${API_BASE_URL}/api/projects/${projectId}/export/dbt`;
  const init: RequestInit = {
    method: "GET",
    headers: getAuthHeaders(),
  };
  let response = await fetch(url, init);
  response = await withAuthRetry(response, url, init);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Export failed: ${response.status} ${errorText}`);
  }

  const blob = await response.blob();

  // Extract filename from Content-Disposition header, fallback to "export.zip"
  const disposition = response.headers.get("Content-Disposition");
  let filename = "export.zip";
  if (disposition) {
    const match = disposition.match(/filename="?([^";\s]+)"?/);
    if (match) filename = match[1];
  }

  // Trigger browser download
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(objectUrl);
}
