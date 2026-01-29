/**
 * Hook for managing transforms on a dataset
 */

import { useState, useCallback, useEffect } from "react";
import {
  createTransform,
  deleteTransform,
  toggleTransform as toggleTransformApi,
  type Dataset,
  type Transform,
  type TransformCreate,
} from "@/api";
import { raqbToTanstackFilters } from "@/raqb";
import type { ColumnFiltersState } from "@tanstack/react-table";
import { mergeFilters } from "./filterUtils";

interface UseTransformsOptions {
  dataset: Dataset | null;
  onDatasetChange?: (dataset: Dataset) => void;
  onFilterApply?: (filters: ColumnFiltersState | ((prev: ColumnFiltersState) => ColumnFiltersState)) => void;
  currentFilters?: ColumnFiltersState;
  autoApplyActive?: boolean;
  onFiltersChanged?: () => void;
}

interface UseTransformsReturn {
  transforms: Transform[];
  loading: boolean;
  error: string | null;
  saveTransform: (data: TransformCreate) => Promise<boolean>;
  removeTransform: (transformId: string) => Promise<boolean>;
  toggleTransform: (transformId: string, isActive: boolean) => Promise<boolean>;
  applyTransform: (transform: Transform) => void;
  applyActiveTransforms: () => void;
}

export function useTransforms(options: UseTransformsOptions): UseTransformsReturn {
  const { dataset, onDatasetChange, onFilterApply, currentFilters = [], autoApplyActive = true, onFiltersChanged } = options;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Transforms come from the dataset
  const transforms = dataset?.transforms ?? [];

  // Auto-apply active transforms when dataset changes
  useEffect(() => {
    if (autoApplyActive && onFilterApply && dataset) {
      console.log("[useTransforms] Auto-applying transforms:", transforms);
      const activeFilters = computeActiveFilters(transforms);
      console.log("[useTransforms] Computed active filters:", activeFilters);
      onFilterApply(activeFilters);
    }
  }, [dataset, transforms, autoApplyActive, onFilterApply]);

  const saveTransform = useCallback(
    async (data: TransformCreate): Promise<boolean> => {
      if (!dataset) {
        setError("No dataset selected");
        return false;
      }

      setLoading(true);
      setError(null);
      try {
        const updatedDataset = await createTransform(dataset.id, data);
        if (onDatasetChange) {
          onDatasetChange(updatedDataset);
        }
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save transform");
        return false;
      } finally {
        setLoading(false);
      }
    },
    [dataset, onDatasetChange]
  );

  const removeTransform = useCallback(
    async (transformId: string): Promise<boolean> => {
      if (!dataset) {
        setError("No dataset ID provided");
        return false;
      }

      setLoading(true);
      setError(null);
      try {
        const updatedDataset = await deleteTransform(dataset.id, transformId);
        if (onDatasetChange) {
          onDatasetChange(updatedDataset);
        }
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete transform");
        return false;
      } finally {
        setLoading(false);
      }
    },
    [dataset, onDatasetChange]
  );

  const toggleTransform = useCallback(
    async (transformId: string, isActive: boolean): Promise<boolean> => {
      if (!dataset) {
        setError("No dataset ID provided");
        return false;
      }

      setLoading(true);
      setError(null);
      try {
        const updatedDataset = await toggleTransformApi(dataset.id, transformId, isActive);
        if (onDatasetChange) {
          onDatasetChange(updatedDataset);
        }

        // Notify that filters changed (to trigger data refetch)
        if (onFiltersChanged) {
          setTimeout(() => {
            onFiltersChanged();
          }, 0);
        }

        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update transform");
        return false;
      } finally {
        setLoading(false);
      }
    },
    [dataset, onDatasetChange, onFiltersChanged]
  );

  const applyTransform = useCallback(
    (transform: Transform) => {
      if (!onFilterApply) return;

      const newFilters = raqbToTanstackFilters(transform.condition_json);

      // Merge with existing filters instead of replacing
      onFilterApply((prevFilters) => mergeFilters(prevFilters, newFilters));
    },
    [onFilterApply]
  );

  const applyActiveTransforms = useCallback(() => {
    if (!onFilterApply) return;

    const activeFilters = computeActiveFilters(transforms);
    onFilterApply(activeFilters);
  }, [transforms, onFilterApply]);

  return {
    transforms,
    loading,
    error,
    saveTransform,
    removeTransform,
    toggleTransform,
    applyTransform,
    applyActiveTransforms,
  };
}

/**
 * Compute merged filters from all active transforms
 */
function computeActiveFilters(transforms: Transform[]): ColumnFiltersState {
  let activeFilters: ColumnFiltersState = [];

  console.log("[computeActiveFilters] Processing transforms:", transforms);

  for (const transform of transforms) {
    console.log("[computeActiveFilters] Transform:", transform.name, "is_active:", transform.is_active);
    if (transform.is_active) {
      const filters = raqbToTanstackFilters(transform.condition_json);
      console.log("[computeActiveFilters] Converted RAQB to filters:", filters);
      activeFilters = mergeFilters(activeFilters, filters);
    }
  }

  console.log("[computeActiveFilters] Final merged filters:", activeFilters);
  return activeFilters;
}
