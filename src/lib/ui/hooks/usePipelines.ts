/**
 * Hook for managing filter pipelines
 */

import { useState, useCallback } from "react";
import {
  listPipelines,
  createPipeline,
  deletePipeline,
  type Pipeline,
  type PipelineCreate,
} from "@/api";
import { raqbToTanstackFilters } from "@/raqb";
import type { ColumnFiltersState } from "@tanstack/react-table";

interface UsePipelinesOptions {
  datasetId?: string;
  onFilterApply?: (filters: ColumnFiltersState) => void;
}

interface UsePipelinesReturn {
  pipelines: Pipeline[];
  loading: boolean;
  error: string | null;
  fetchPipelines: () => Promise<void>;
  savePipeline: (data: Omit<PipelineCreate, "dataset_id">) => Promise<Pipeline | null>;
  removePipeline: (pipelineId: string) => Promise<boolean>;
  applyPipeline: (pipeline: Pipeline) => void;
}

export function usePipelines(options: UsePipelinesOptions = {}): UsePipelinesReturn {
  const { datasetId, onFilterApply } = options;

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPipelines = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listPipelines(datasetId, true);
      setPipelines(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch pipelines");
    } finally {
      setLoading(false);
    }
  }, [datasetId]);

  const savePipeline = useCallback(
    async (data: Omit<PipelineCreate, "dataset_id">): Promise<Pipeline | null> => {
      if (!datasetId) {
        setError("No dataset selected");
        return null;
      }

      setLoading(true);
      setError(null);
      try {
        const pipeline = await createPipeline({
          ...data,
          dataset_id: datasetId,
        });
        setPipelines((prev) => [pipeline, ...prev]);
        return pipeline;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save pipeline");
        return null;
      } finally {
        setLoading(false);
      }
    },
    [datasetId]
  );

  const removePipeline = useCallback(async (pipelineId: string): Promise<boolean> => {
    setLoading(true);
    setError(null);
    try {
      await deletePipeline(pipelineId);
      setPipelines((prev) => prev.filter((p) => p.id !== pipelineId));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete pipeline");
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const applyPipeline = useCallback(
    (pipeline: Pipeline) => {
      if (!onFilterApply) return;

      // Convert RAQB JSON to TanStack filters
      const filters = raqbToTanstackFilters(pipeline.raqb_json);
      onFilterApply(filters);
    },
    [onFilterApply]
  );

  return {
    pipelines,
    loading,
    error,
    fetchPipelines,
    savePipeline,
    removePipeline,
    applyPipeline,
  };
}
