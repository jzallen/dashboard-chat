/**
 * Projects API
 */

import { get, post, patch, del } from "./client";

export interface Project {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectCreate {
  name: string;
  description?: string;
}

export interface ProjectUpdate {
  name?: string;
  description?: string;
}

/**
 * List all projects
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
 * Create a new project
 */
export async function createProject(data: ProjectCreate): Promise<Project> {
  return post<Project>("/api/projects", data);
}

/**
 * Update a project
 */
export async function updateProject(
  projectId: string,
  data: ProjectUpdate
): Promise<Project> {
  return patch<Project>(`/api/projects/${projectId}`, data);
}

/**
 * Delete a project
 */
export async function deleteProject(
  projectId: string
): Promise<{ status: string; id: string }> {
  return del<{ status: string; id: string }>(`/api/projects/${projectId}`);
}
