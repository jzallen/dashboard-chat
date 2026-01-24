/**
 * Datasets API
 */

import { get, post, patch, del, uploadFile } from "./client";
import type { RAQBTree } from "@/raqb";

export interface FieldConfig {
  label: string;
  type: "text" | "number" | "boolean" | "datetime" | "select";
  operators: string[];
  listValues?: Array<{ value: string; title: string }>;
  nullable: boolean;
}

export interface SchemaConfig {
  fields: Record<string, FieldConfig>;
}

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

export interface Dataset {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  table_name: string;
  schema_config: SchemaConfig;
  row_count: number;
  file_name: string | null;
  file_size: number | null;
  created_at: string;
  updated_at: string;
  transforms: Transform[];
  preview_rows: Record<string, unknown>[];
}

export interface DatasetUploadResponse extends Dataset {
  preview_rows: Record<string, unknown>[];
}

export interface DatasetUpdate {
  name?: string;
  description?: string;
}

export interface TransformCreate {
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

export interface AggregatedSqlResponse {
  dataset_id: string;
  enabled_transform_count: number;
  sql_where_clause: string;
  transform_ids: string[];
}

/**
 * List all datasets, optionally filtered by project
 */
export async function listDatasets(projectId?: string): Promise<Dataset[]> {
  const query = projectId ? `?project_id=${projectId}` : "";
  return get<Dataset[]>(`/api/datasets${query}`);
}

/**
 * Get a single dataset by ID with optional transforms and preview
 */
export async function getDataset(
  datasetId: string,
  options?: {
    includeTransforms?: boolean;
    includePreview?: boolean;
    previewLimit?: number;
  }
): Promise<Dataset> {
  const params = new URLSearchParams();
  if (options?.includeTransforms !== undefined) {
    params.append("include_transforms", String(options.includeTransforms));
  }
  if (options?.includePreview) {
    params.append("include_preview", "true");
    if (options.previewLimit) {
      params.append("preview_limit", String(options.previewLimit));
    }
  }

  const query = params.toString() ? `?${params.toString()}` : "";
  return get<Dataset>(`/api/datasets/${datasetId}${query}`);
}

/**
 * Upload a CSV file to create a dataset
 */
export async function uploadDataset(
  projectId: string,
  name: string,
  file: File,
  description?: string
): Promise<DatasetUploadResponse> {
  const fields: Record<string, string> = {
    project_id: projectId,
    name,
  };
  if (description) {
    fields.description = description;
  }

  return uploadFile<DatasetUploadResponse>("/api/datasets/upload", file, fields);
}

/**
 * Update a dataset's metadata
 */
export async function updateDataset(
  datasetId: string,
  data: DatasetUpdate
): Promise<Dataset> {
  return patch<Dataset>(`/api/datasets/${datasetId}`, data);
}

/**
 * Delete a dataset
 */
export async function deleteDataset(
  datasetId: string
): Promise<{ status: string; id: string }> {
  return del<{ status: string; id: string }>(`/api/datasets/${datasetId}`);
}

// Transform management

/**
 * List all transforms for a dataset
 */
export async function listDatasetTransforms(
  datasetId: string,
  activeOnly = true
): Promise<Transform[]> {
  const params = new URLSearchParams();
  params.append("active_only", String(activeOnly));

  const query = params.toString() ? `?${params.toString()}` : "";
  return get<Transform[]>(`/api/datasets/${datasetId}/transforms${query}`);
}

/**
 * Get a single transform by ID
 */
export async function getDatasetTransform(
  datasetId: string,
  transformId: string
): Promise<Transform> {
  return get<Transform>(`/api/datasets/${datasetId}/transforms/${transformId}`);
}

/**
 * Create a new transform for a dataset
 */
export async function createDatasetTransform(
  datasetId: string,
  data: TransformCreate
): Promise<Transform> {
  return post<Transform>(`/api/datasets/${datasetId}/transforms`, data);
}

/**
 * Update a transform
 */
export async function updateDatasetTransform(
  datasetId: string,
  transformId: string,
  data: TransformUpdate
): Promise<Transform> {
  return patch<Transform>(`/api/datasets/${datasetId}/transforms/${transformId}`, data);
}

/**
 * Delete a transform
 */
export async function deleteDatasetTransform(
  datasetId: string,
  transformId: string
): Promise<{ status: string; id: string }> {
  return del<{ status: string; id: string }>(
    `/api/datasets/${datasetId}/transforms/${transformId}`
  );
}

/**
 * Get aggregated SQL for all active transforms on a dataset
 */
export async function getDatasetAggregatedSql(
  datasetId: string
): Promise<AggregatedSqlResponse> {
  return get<AggregatedSqlResponse>(`/api/datasets/${datasetId}/aggregated-sql`);
}
