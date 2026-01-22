/**
 * Datasets API
 */

import { get, patch, del, uploadFile } from "./client";

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
}

export interface DatasetUploadResponse extends Dataset {
  preview_rows: Record<string, unknown>[];
}

export interface DatasetUpdate {
  name?: string;
  description?: string;
}

/**
 * List all datasets, optionally filtered by project
 */
export async function listDatasets(projectId?: string): Promise<Dataset[]> {
  const query = projectId ? `?project_id=${projectId}` : "";
  return get<Dataset[]>(`/api/datasets${query}`);
}

/**
 * Get a single dataset by ID
 */
export async function getDataset(datasetId: string): Promise<Dataset> {
  return get<Dataset>(`/api/datasets/${datasetId}`);
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

/**
 * Get preview rows from a dataset
 */
export async function getDatasetPreview(
  datasetId: string,
  limit = 10
): Promise<{
  dataset_id: string;
  row_count: number;
  rows: Record<string, unknown>[];
}> {
  return get(`/api/datasets/${datasetId}/preview?limit=${limit}`);
}

/**
 * Get the RAQB schema for a dataset
 */
export async function getDatasetSchema(datasetId: string): Promise<{
  dataset_id: string;
  schema_config: SchemaConfig;
}> {
  return get(`/api/datasets/${datasetId}/schema`);
}
