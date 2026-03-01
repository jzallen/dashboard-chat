import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnFiltersState } from "@tanstack/react-table";
import { useCallback, useEffect, useMemo } from "react";

import {
  createTransform,
  type Dataset,
  deleteTransform,
  toggleTransform as toggleTransformApi,
  type Transform,
  type TransformCreate,
} from "@/api";
import { raqbToTanstackFilters } from "@/raqb";

import { mergeFilters } from "./filterUtils";
import { datasetKeys } from "./useDatasetQuery";

export function useSaveTransform(datasetId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: TransformCreate) => createTransform(datasetId, data),
    onMutate: async (newTransform) => {
      await queryClient.cancelQueries({ queryKey: datasetKeys.detail(datasetId) });
      const previous = queryClient.getQueryData<Dataset>(datasetKeys.detail(datasetId));
      queryClient.setQueryData<Dataset>(datasetKeys.detail(datasetId), (old) => {
        if (!old) return old;
        const optimistic: Transform = {
          id: crypto.randomUUID(),
          name: newTransform.name,
          description: newTransform.description ?? null,
          condition_json: newTransform.condition_json ?? null,
          condition_sql: newTransform.condition_sql ?? null,
          status: "enabled",
          transform_type: newTransform.transform_type ?? "filter",
          target_column: newTransform.target_column ?? null,
          expression_config: (newTransform.expression_config ?? null) as Transform["expression_config"],
          expression_sql: null,
          created_at: new Date().toISOString(),
        };
        return { ...old, transforms: [...old.transforms, optimistic] };
      });
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(datasetKeys.detail(datasetId), context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: datasetKeys.detail(datasetId), exact: true });
    },
  });
}

export function useDeleteTransform(datasetId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (transformId: string) => deleteTransform(datasetId, transformId),
    onMutate: async (transformId) => {
      await queryClient.cancelQueries({ queryKey: datasetKeys.detail(datasetId) });
      const previous = queryClient.getQueryData<Dataset>(datasetKeys.detail(datasetId));
      queryClient.setQueryData<Dataset>(datasetKeys.detail(datasetId), (old) => {
        if (!old) return old;
        return { ...old, transforms: old.transforms.filter((t) => t.id !== transformId) };
      });
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(datasetKeys.detail(datasetId), context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: datasetKeys.detail(datasetId), exact: true });
    },
  });
}

export function useToggleTransform(datasetId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ transformId, isActive }: { transformId: string; isActive: boolean }) =>
      toggleTransformApi(datasetId, transformId, isActive),
    onMutate: async ({ transformId, isActive }) => {
      await queryClient.cancelQueries({ queryKey: datasetKeys.detail(datasetId) });
      const previous = queryClient.getQueryData<Dataset>(datasetKeys.detail(datasetId));
      const newStatus = isActive ? "enabled" : "disabled";
      queryClient.setQueryData<Dataset>(datasetKeys.detail(datasetId), (old) => {
        if (!old) return old;
        return {
          ...old,
          transforms: old.transforms.map((t) =>
            t.id === transformId ? { ...t, status: newStatus } as Transform : t
          ),
        };
      });
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(datasetKeys.detail(datasetId), context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: datasetKeys.detail(datasetId), exact: true });
    },
  });
}

interface UseTransformsOptions {
  dataset: Dataset | null;
  onFilterApply?: (filters: ColumnFiltersState | ((prev: ColumnFiltersState) => ColumnFiltersState)) => void;
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
  const { dataset, onFilterApply, autoApplyActive = true, onFiltersChanged } = options;
  const datasetId = dataset?.id ?? "";

  const saveMutation = useSaveTransform(datasetId);
  const deleteMutation = useDeleteTransform(datasetId);
  const toggleMutation = useToggleTransform(datasetId);

  const transforms = useMemo(() => dataset?.transforms ?? [], [dataset?.transforms]);

  useEffect(() => {
    if (autoApplyActive && onFilterApply && dataset) {
      const activeFilters = computeActiveFilters(transforms);
      onFilterApply(activeFilters);
    }
  }, [dataset, transforms, autoApplyActive, onFilterApply]);

  const saveTransform = useCallback(
    async (data: TransformCreate): Promise<boolean> => {
      if (!dataset) return false;
      try {
        await saveMutation.mutateAsync(data);
        return true;
      } catch {
        return false;
      }
    },
    [dataset, saveMutation]
  );

  const removeTransform = useCallback(
    async (transformId: string): Promise<boolean> => {
      if (!dataset) return false;
      try {
        await deleteMutation.mutateAsync(transformId);
        return true;
      } catch {
        return false;
      }
    },
    [dataset, deleteMutation]
  );

  const toggleTransform = useCallback(
    async (transformId: string, isActive: boolean): Promise<boolean> => {
      if (!dataset) return false;
      try {
        await toggleMutation.mutateAsync({ transformId, isActive });
        if (onFiltersChanged) {
          setTimeout(() => onFiltersChanged(), 0);
        }
        return true;
      } catch {
        return false;
      }
    },
    [dataset, toggleMutation, onFiltersChanged]
  );

  const applyTransform = useCallback(
    (transform: Transform) => {
      if (!onFilterApply) return;
      if ((transform.transform_type ?? "filter") !== "filter" || !transform.condition_json) return;

      const { filters: newFilters } = raqbToTanstackFilters(transform.condition_json, {
        transformId: transform.id,
      });
      onFilterApply((prevFilters) => mergeFilters(prevFilters, newFilters));
    },
    [onFilterApply]
  );

  const applyActiveTransforms = useCallback(() => {
    if (!onFilterApply) return;
    const activeFilters = computeActiveFilters(transforms);
    onFilterApply(activeFilters);
  }, [transforms, onFilterApply]);

  const loading = saveMutation.isPending || deleteMutation.isPending || toggleMutation.isPending;
  const error = saveMutation.error?.message ?? deleteMutation.error?.message ?? toggleMutation.error?.message ?? null;

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

function computeActiveFilters(transforms: Transform[]): ColumnFiltersState {
  let activeFilters: ColumnFiltersState = [];

  for (const transform of transforms) {
    if (transform.status === "enabled" && (transform.transform_type ?? "filter") === "filter" && transform.condition_json) {
      const { filters } = raqbToTanstackFilters(transform.condition_json, {
        transformId: transform.id,
      });
      activeFilters = mergeFilters(activeFilters, filters);
    }
  }

  return activeFilters;
}
