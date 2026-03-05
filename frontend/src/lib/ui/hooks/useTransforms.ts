import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnFiltersState } from "@tanstack/react-table";
import { useCallback, useEffect, useMemo } from "react";

import { withAuth } from "@/auth";
import {
  createDataCatalog,
  type Dataset,
  type Transform,
  type TransformCreate,
} from "@/dataCatalog";
import { raqbToTanstackFilters } from "@/raqb";

import { mergeFilters } from "./filterUtils";
import { datasetKeys } from "./useDatasetQuery";

const catalog = createDataCatalog(withAuth(fetch));

/** Saves a new transform with optimistic cache update. Invalidates dataset on settle. */
export function useSaveTransform(datasetId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: TransformCreate) =>
      catalog.createTransform(datasetId, data),
    onMutate: async (newTransform) => {
      await queryClient.cancelQueries({
        queryKey: datasetKeys.detail(datasetId),
      });
      const previous = queryClient.getQueryData<Dataset>(
        datasetKeys.detail(datasetId),
      );
      queryClient.setQueryData<Dataset>(
        datasetKeys.detail(datasetId),
        (old) => {
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
            expression_config: (newTransform.expression_config ??
              null) as Transform["expression_config"],
            expression_sql: null,
            created_at: new Date().toISOString(),
          };
          return { ...old, transforms: [...old.transforms, optimistic] };
        },
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          datasetKeys.detail(datasetId),
          context.previous,
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: datasetKeys.detail(datasetId),
        exact: true,
      });
    },
  });
}

/** Deletes a transform with optimistic cache removal. Invalidates dataset on settle. */
export function useDeleteTransform(datasetId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (transformId: string) =>
      catalog.deleteTransform(datasetId, transformId),
    onMutate: async (transformId) => {
      await queryClient.cancelQueries({
        queryKey: datasetKeys.detail(datasetId),
      });
      const previous = queryClient.getQueryData<Dataset>(
        datasetKeys.detail(datasetId),
      );
      queryClient.setQueryData<Dataset>(
        datasetKeys.detail(datasetId),
        (old) => {
          if (!old) return old;
          return {
            ...old,
            transforms: old.transforms.filter((t) => t.id !== transformId),
          };
        },
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          datasetKeys.detail(datasetId),
          context.previous,
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: datasetKeys.detail(datasetId),
        exact: true,
      });
    },
  });
}

/** Toggles a transform's enabled/disabled status with optimistic cache update. */
export function useToggleTransform(datasetId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      transformId,
      isActive,
    }: {
      transformId: string;
      isActive: boolean;
    }) => catalog.toggleTransform(datasetId, transformId, isActive),
    onMutate: async ({ transformId, isActive }) => {
      await queryClient.cancelQueries({
        queryKey: datasetKeys.detail(datasetId),
      });
      const previous = queryClient.getQueryData<Dataset>(
        datasetKeys.detail(datasetId),
      );
      const newStatus = isActive ? "enabled" : "disabled";
      queryClient.setQueryData<Dataset>(
        datasetKeys.detail(datasetId),
        (old) => {
          if (!old) return old;
          return {
            ...old,
            transforms: old.transforms.map((t) =>
              t.id === transformId
                ? ({ ...t, status: newStatus } as Transform)
                : t,
            ),
          };
        },
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          datasetKeys.detail(datasetId),
          context.previous,
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: datasetKeys.detail(datasetId),
        exact: true,
      });
    },
  });
}

/** Options for the {@link useTransforms} hook. */
interface UseTransformsOptions {
  /** The dataset whose transforms to manage (null during loading). */
  dataset: Dataset | null;
  /** Callback to push filter state to TanStack Table's column filters. */
  onFilterApply?: (
    filters:
      | ColumnFiltersState
      | ((prev: ColumnFiltersState) => ColumnFiltersState),
  ) => void;
  /** Whether to auto-apply saved filters on mount (default: true). */
  autoApplyActive?: boolean;
  /** Called after a transform toggle so the table can refresh data. */
  onFiltersChanged?: () => void;
}

/** Return value of the {@link useTransforms} hook. */
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

/**
 * Manages transform lifecycle (save, delete, toggle) for a dataset.
 * Automatically applies active filter transforms when the dataset loads.
 *
 * @param options.dataset - The dataset whose transforms to manage (null during loading)
 * @param options.onFilterApply - Callback to push filter state to TanStack Table
 * @param options.autoApplyActive - Whether to auto-apply saved filters on mount (default: true)
 */
export function useTransforms(
  options: UseTransformsOptions,
): UseTransformsReturn {
  const {
    dataset,
    onFilterApply,
    autoApplyActive = true,
    onFiltersChanged,
  } = options;
  const datasetId = dataset?.id ?? "";

  const saveMutation = useSaveTransform(datasetId);
  const deleteMutation = useDeleteTransform(datasetId);
  const toggleMutation = useToggleTransform(datasetId);

  const transforms = useMemo(
    () => dataset?.transforms ?? [],
    [dataset?.transforms],
  );

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
    [dataset, saveMutation],
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
    [dataset, deleteMutation],
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
    [dataset, toggleMutation, onFiltersChanged],
  );

  const applyTransform = useCallback(
    (transform: Transform) => {
      if (!onFilterApply) return;
      const isFilterWithCondition =
        (transform.transform_type ?? "filter") === "filter" &&
        transform.condition_json;
      if (!isFilterWithCondition) return;

      const { filters: newFilters } = raqbToTanstackFilters(
        transform.condition_json!,
        {
          transformId: transform.id,
        },
      );
      onFilterApply((prevFilters) => mergeFilters(prevFilters, newFilters));
    },
    [onFilterApply],
  );

  const applyActiveTransforms = useCallback(() => {
    if (!onFilterApply) return;
    const activeFilters = computeActiveFilters(transforms);
    onFilterApply(activeFilters);
  }, [transforms, onFilterApply]);

  const loading =
    saveMutation.isPending ||
    deleteMutation.isPending ||
    toggleMutation.isPending;
  const error =
    saveMutation.error?.message ??
    deleteMutation.error?.message ??
    toggleMutation.error?.message ??
    null;

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
    const isApplicableFilter =
      transform.status === "enabled" &&
      (transform.transform_type ?? "filter") === "filter" &&
      transform.condition_json;

    if (isApplicableFilter) {
      const { filters } = raqbToTanstackFilters(transform.condition_json!, {
        transformId: transform.id,
      });
      activeFilters = mergeFilters(activeFilters, filters);
    }
  }

  return activeFilters;
}
