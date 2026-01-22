/**
 * Pipelines API
 */

import { get, post, patch, del } from "./client";
import type { RAQBTree } from "@/raqb";

export interface Pipeline {
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

export interface PipelineCreate {
  dataset_id: string;
  name: string;
  description?: string;
  raqb_json: RAQBTree;
  nl_prompt?: string;
}

export interface PipelineUpdate {
  name?: string;
  description?: string;
  raqb_json?: RAQBTree;
}

export interface PipelineRun {
  id: string;
  pipeline_id: string;
  status: "pending" | "running" | "completed" | "failed";
  input_row_count: number | null;
  output_row_count: number | null;
  execution_time_ms: number | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface PipelineExecuteResponse {
  pipeline_id: string;
  input_row_count: number;
  output_row_count: number;
  execution_time_ms: number;
  rows: Record<string, unknown>[];
}

/**
 * List all pipelines, optionally filtered by dataset
 */
export async function listPipelines(
  datasetId?: string,
  activeOnly = true
): Promise<Pipeline[]> {
  const params = new URLSearchParams();
  if (datasetId) {
    params.append("dataset_id", datasetId);
  }
  params.append("active_only", String(activeOnly));

  const query = params.toString() ? `?${params.toString()}` : "";
  return get<Pipeline[]>(`/api/pipelines${query}`);
}

/**
 * Get a single pipeline by ID
 */
export async function getPipeline(pipelineId: string): Promise<Pipeline> {
  return get<Pipeline>(`/api/pipelines/${pipelineId}`);
}

/**
 * Create a new pipeline
 */
export async function createPipeline(data: PipelineCreate): Promise<Pipeline> {
  return post<Pipeline>("/api/pipelines", data);
}

/**
 * Update a pipeline
 */
export async function updatePipeline(
  pipelineId: string,
  data: PipelineUpdate
): Promise<Pipeline> {
  return patch<Pipeline>(`/api/pipelines/${pipelineId}`, data);
}

/**
 * Delete a pipeline
 */
export async function deletePipeline(
  pipelineId: string
): Promise<{ status: string; id: string }> {
  return del<{ status: string; id: string }>(`/api/pipelines/${pipelineId}`);
}

/**
 * Deactivate a pipeline (soft delete)
 */
export async function deactivatePipeline(pipelineId: string): Promise<Pipeline> {
  return post<Pipeline>(`/api/pipelines/${pipelineId}/deactivate`, {});
}

/**
 * Execute a pipeline and get results
 */
export async function executePipeline(
  pipelineId: string,
  limit = 100,
  offset = 0
): Promise<PipelineExecuteResponse> {
  return post<PipelineExecuteResponse>(`/api/pipelines/${pipelineId}/execute`, {
    limit,
    offset,
  });
}

/**
 * List recent runs for a pipeline
 */
export async function listPipelineRuns(
  pipelineId: string,
  limit = 10
): Promise<PipelineRun[]> {
  return get<PipelineRun[]>(`/api/pipelines/${pipelineId}/runs?limit=${limit}`);
}
