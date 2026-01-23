/**
 * Hook for managing filter pipelines
 */

import { useState, useCallback } from "react";
import {
  listPipelines,
  createPipeline,
  deletePipeline,
  updatePipeline,
  type Pipeline,
  type PipelineCreate,
} from "@/api";
import { raqbToTanstackFilters } from "@/raqb";
import type { ColumnFiltersState } from "@tanstack/react-table";
import { mergeFilters } from "./filterUtils";

interface UsePipelinesOptions {
  datasetId?: string;
  onFilterApply?: (filters: ColumnFiltersState | ((prev: ColumnFiltersState) => ColumnFiltersState)) => void;
  currentFilters?: ColumnFiltersState;
  autoApplyActive?: boolean;
  activeOnly?: boolean;
  onInitialized?: () => void;
  onFiltersChanged?: () => void;
}

interface UsePipelinesReturn {
  pipelines: Pipeline[];
  loading: boolean;
  error: string | null;
  initialized: boolean;
  fetchPipelines: () => Promise<void>;
  savePipeline: (data: Omit<PipelineCreate, "dataset_id">) => Promise<Pipeline | null>;
  removePipeline: (pipelineId: string) => Promise<boolean>;
  togglePipeline: (pipelineId: string, isActive: boolean) => Promise<boolean>;
  applyPipeline: (pipeline: Pipeline) => void;
  applyActivePipelines: () => void;
}

export function usePipelines(options: UsePipelinesOptions = {}): UsePipelinesReturn {
  const { datasetId, onFilterApply, currentFilters = [], autoApplyActive = true, activeOnly = true, onInitialized, onFiltersChanged } = options;

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPipelines = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listPipelines(datasetId, activeOnly);
      setPipelines(data);

      // Auto-apply active pipelines on fetch if enabled
      if (autoApplyActive && onFilterApply) {
        const activeFilters = computeActiveFilters(data);
        onFilterApply(activeFilters);
      }

      setInitialized(true);

      // Notify that initialization is complete
      if (onInitialized) {
        onInitialized();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch pipelines");
      setInitialized(true); // Mark as initialized even on error so we don't block forever

      // Notify even on error so we don't block forever
      if (onInitialized) {
        onInitialized();
      }
    } finally {
      setLoading(false);
    }
  }, [datasetId, autoApplyActive, activeOnly, onFilterApply, onInitialized]);

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

  const togglePipeline = useCallback(async (pipelineId: string, isActive: boolean): Promise<boolean> => {
    setLoading(true);
    setError(null);
    try {
      const updatedPipeline = await updatePipeline(pipelineId, { is_active: isActive });
      setPipelines((prev) => {
        const updated = prev.map((p) => (p.id === pipelineId ? updatedPipeline : p));

        // Auto-apply active pipelines after toggle if enabled
        if (autoApplyActive && onFilterApply) {
          setTimeout(() => {
            const activeFilters = computeActiveFilters(updated);
            onFilterApply(activeFilters);

            // Notify that filters changed (to trigger data refetch)
            if (onFiltersChanged) {
              onFiltersChanged();
            }
          }, 0);
        }

        return updated;
      });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update pipeline");
      return false;
    } finally {
      setLoading(false);
    }
  }, [autoApplyActive, onFilterApply, onFiltersChanged]);

  const applyPipeline = useCallback(
    (pipeline: Pipeline) => {
      if (!onFilterApply) return;

      const newFilters = raqbToTanstackFilters(pipeline.raqb_json);

      // Merge with existing filters instead of replacing
      onFilterApply((prevFilters) => mergeFilters(prevFilters, newFilters));
    },
    [onFilterApply]
  );

  const applyActivePipelines = useCallback(() => {
    if (!onFilterApply) return;

    const activeFilters = computeActiveFilters(pipelines);
    onFilterApply(activeFilters);
  }, [pipelines, onFilterApply]);

  return {
    pipelines,
    loading,
    initialized,
    error,
    fetchPipelines,
    savePipeline,
    removePipeline,
    togglePipeline,
    applyPipeline,
    applyActivePipelines,
  };
}

/**
 * Compute merged filters from all active pipelines
 */
function computeActiveFilters(pipelines: Pipeline[]): ColumnFiltersState {
  let activeFilters: ColumnFiltersState = [];

  for (const pipeline of pipelines) {
    if (pipeline.is_active) {
      const filters = raqbToTanstackFilters(pipeline.raqb_json);
      activeFilters = mergeFilters(activeFilters, filters);
    }
  }

  return activeFilters;
}
