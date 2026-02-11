/**
 * Hook for managing transforms on a dataset.
 *
 * Uses optimistic updates — mutates the local Dataset cache immediately,
 * fires the API call in the background, and rolls back on error.
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
  const { dataset, onDatasetChange, onFilterApply, autoApplyActive = true, onFiltersChanged } = options;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Transforms come from the dataset
  const transforms = dataset?.transforms ?? [];

  // Auto-apply active transforms when dataset changes
  useEffect(() => {
    if (autoApplyActive && onFilterApply && dataset) {
      const activeFilters = computeActiveFilters(transforms);
      onFilterApply(activeFilters);
    }
  }, [dataset, transforms, autoApplyActive, onFilterApply]);

  const saveTransform = useCallback(
    async (data: TransformCreate): Promise<boolean> => {
      if (!dataset) {
        setError("No dataset selected");
        return false;
      }

      const originalDataset = dataset;

      // Optimistic update — add transform with temp ID
      const optimisticTransform: Transform = {
        id: crypto.randomUUID(),
        name: data.name,
        description: data.description ?? null,
        condition_json: data.condition_json,
        condition_sql: data.condition_sql,
        status: 'enabled',
      };
      const optimisticDataset: Dataset = {
        ...dataset,
        transforms: [...dataset.transforms, optimisticTransform],
      };
      onDatasetChange?.(optimisticDataset);

      setLoading(true);
      setError(null);
      try {
        await createTransform(dataset.id, data);
        return true;
      } catch (err) {
        // Rollback on error
        onDatasetChange?.(originalDataset);
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

      const originalDataset = dataset;

      // Optimistic update — remove transform from list
      const optimisticDataset: Dataset = {
        ...dataset,
        transforms: dataset.transforms.filter((t) => t.id !== transformId),
      };
      onDatasetChange?.(optimisticDataset);

      setLoading(true);
      setError(null);
      try {
        await deleteTransform(dataset.id, transformId);
        return true;
      } catch (err) {
        onDatasetChange?.(originalDataset);
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

      const originalDataset = dataset;
      const newStatus = isActive ? 'enabled' : 'disabled';

      // Optimistic update — flip status on matching transform
      const optimisticDataset: Dataset = {
        ...dataset,
        transforms: dataset.transforms.map((t) =>
          t.id === transformId ? { ...t, status: newStatus } as Transform : t
        ),
      };
      onDatasetChange?.(optimisticDataset);

      setLoading(true);
      setError(null);
      try {
        await toggleTransformApi(dataset.id, transformId, isActive);

        // Notify that filters changed (to trigger data refetch)
        if (onFiltersChanged) {
          setTimeout(() => {
            onFiltersChanged();
          }, 0);
        }

        return true;
      } catch (err) {
        onDatasetChange?.(originalDataset);
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

      const newFilters = raqbToTanstackFilters(transform.condition_json, {
        transformId: transform.id,
      });

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

  for (const transform of transforms) {
    if (transform.status === 'enabled') {
      const filters = raqbToTanstackFilters(transform.condition_json, {
        transformId: transform.id,
      });
      activeFilters = mergeFilters(activeFilters, filters);
    }
  }

  return activeFilters;
}
