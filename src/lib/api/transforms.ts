/**
 * Transforms API
 */

import { get, post, patch, del } from "./client";
import type { RAQBTree } from "@/raqb";

export interface Transform {
  id: string;
  dataset_id: string;
  name: string;
  description: string | null;
  raqb_json: RAQBTree;
  cached_sql: string | null;
  version: number;
  is_active: boolean;
  nl_prompt: string | null;
  created_at: string;
  updated_at: string;
}

export interface TransformCreate {
  dataset_id: string;
  name: string;
  description?: string;
  raqb_json: RAQBTree;
  nl_prompt?: string;
}

export interface TransformUpdate {
  name?: string;
  description?: string;
  raqb_json?: RAQBTree;
  is_active?: boolean;
}

/**
 * List all transforms, optionally filtered by dataset
 */
export async function listTransforms(
  datasetId?: string,
  activeOnly = true
): Promise<Transform[]> {
  const params = new URLSearchParams();
  if (datasetId) {
    params.append("dataset_id", datasetId);
  }
  params.append("active_only", String(activeOnly));

  const query = params.toString() ? `?${params.toString()}` : "";
  return get<Transform[]>(`/api/transforms${query}`);
}

/**
 * Get a single transform by ID
 */
export async function getTransform(transformId: string): Promise<Transform> {
  return get<Transform>(`/api/transforms/${transformId}`);
}

/**
 * Create a new transform
 */
export async function createTransform(data: TransformCreate): Promise<Transform> {
  return post<Transform>("/api/transforms", data);
}

/**
 * Update a transform
 */
export async function updateTransform(
  transformId: string,
  data: TransformUpdate
): Promise<Transform> {
  return patch<Transform>(`/api/transforms/${transformId}`, data);
}

/**
 * Delete a transform
 */
export async function deleteTransform(
  transformId: string
): Promise<{ status: string; id: string }> {
  return del<{ status: string; id: string }>(`/api/transforms/${transformId}`);
}
