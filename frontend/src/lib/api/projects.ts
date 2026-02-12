/**
 * Projects API
 */

import { get } from "./client";
import type { SchemaConfig } from "./datasets";

export interface DatasetSparse {
  id: string;
  name: string;
  link: string;
  description: string | null;
  row_count?: number;
  schema_config: SchemaConfig;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  datasets: DatasetSparse[];
}

/**
 * Get a single project by ID
 */
export async function getProject(projectId: string): Promise<Project> {
  return get<Project>(`/api/projects/${projectId}`);
}
