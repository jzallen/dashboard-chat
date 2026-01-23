/**
 * Hook for managing transforms
 */

import { useState, useCallback } from "react";
import {
  listTransforms,
  createTransform,
  deleteTransform,
  updateTransform,
  type Transform,
  type TransformCreate,
} from "@/api";
import { raqbToTanstackFilters } from "@/raqb";
import type { ColumnFiltersState } from "@tanstack/react-table";
import { mergeFilters } from "./filterUtils";

interface UseTransformsOptions {
  datasetId?: string;
  onFilterApply?: (filters: ColumnFiltersState | ((prev: ColumnFiltersState) => ColumnFiltersState)) => void;
  currentFilters?: ColumnFiltersState;
  autoApplyActive?: boolean;
  activeOnly?: boolean;
  onInitialized?: () => void;
  onFiltersChanged?: () => void;
}

interface UseTransformsReturn {
  transforms: Transform[];
  loading: boolean;
  error: string | null;
  initialized: boolean;
  fetchTransforms: () => Promise<void>;
  saveTransform: (data: Omit<TransformCreate, "dataset_id">) => Promise<Transform | null>;
  removeTransform: (transformId: string) => Promise<boolean>;
  toggleTransform: (transformId: string, isActive: boolean) => Promise<boolean>;
  applyTransform: (transform: Transform) => void;
  applyActiveTransforms: () => void;
}

export function useTransforms(options: UseTransformsOptions = {}): UseTransformsReturn {
  const { datasetId, onFilterApply, currentFilters = [], autoApplyActive = true, activeOnly = true, onInitialized, onFiltersChanged } = options;

  const [transforms, setTransforms] = useState<Transform[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTransforms = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listTransforms(datasetId, activeOnly);
      setTransforms(data);

      // Auto-apply active transforms on fetch if enabled
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
      setError(err instanceof Error ? err.message : "Failed to fetch transforms");
      setInitialized(true); // Mark as initialized even on error so we don't block forever

      // Notify even on error so we don't block forever
      if (onInitialized) {
        onInitialized();
      }
    } finally {
      setLoading(false);
    }
  }, [datasetId, autoApplyActive, activeOnly, onFilterApply, onInitialized]);

  const saveTransform = useCallback(
    async (data: Omit<TransformCreate, "dataset_id">): Promise<Transform | null> => {
      if (!datasetId) {
        setError("No dataset selected");
        return null;
      }

      setLoading(true);
      setError(null);
      try {
        const transform = await createTransform({
          ...data,
          dataset_id: datasetId,
        });
        setTransforms((prev) => [transform, ...prev]);
        return transform;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save transform");
        return null;
      } finally {
        setLoading(false);
      }
    },
    [datasetId]
  );

  const removeTransform = useCallback(async (transformId: string): Promise<boolean> => {
    setLoading(true);
    setError(null);
    try {
      await deleteTransform(transformId);
      setTransforms((prev) => prev.filter((t) => t.id !== transformId));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete transform");
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const toggleTransform = useCallback(async (transformId: string, isActive: boolean): Promise<boolean> => {
    setLoading(true);
    setError(null);
    try {
      const updatedTransform = await updateTransform(transformId, { is_active: isActive });
      setTransforms((prev) => {
        const updated = prev.map((t) => (t.id === transformId ? updatedTransform : t));

        // Auto-apply active transforms after toggle if enabled
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
      setError(err instanceof Error ? err.message : "Failed to update transform");
      return false;
    } finally {
      setLoading(false);
    }
  }, [autoApplyActive, onFilterApply, onFiltersChanged]);

  const applyTransform = useCallback(
    (transform: Transform) => {
      if (!onFilterApply) return;

      const newFilters = raqbToTanstackFilters(transform.raqb_json);

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
    initialized,
    error,
    fetchTransforms,
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
    if (transform.is_active) {
      const filters = raqbToTanstackFilters(transform.raqb_json);
      activeFilters = mergeFilters(activeFilters, filters);
    }
  }

  return activeFilters;
}
