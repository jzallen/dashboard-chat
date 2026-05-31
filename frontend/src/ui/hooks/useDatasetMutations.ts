import { useMutation, useQueryClient } from "@tanstack/react-query";

import { withAuth } from "@/auth";
import {
  createDataCatalog,
  type Dataset,
  type DatasetSparse,
} from "@/dataCatalog";

import { datasetKeys } from "./queryKeys";

const catalog = createDataCatalog(withAuth(fetch));

/** Renames a dataset with optimistic updates to both detail and list caches. */
export function useRenameDataset(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ datasetId, name }: { datasetId: string; name: string }) =>
      catalog.updateDataset(datasetId, { name }),

    onMutate: async ({ datasetId, name }) => {
      await queryClient.cancelQueries({
        queryKey: datasetKeys.detail(datasetId),
      });
      await queryClient.cancelQueries({
        queryKey: datasetKeys.list(projectId),
      });

      const prevDataset = queryClient.getQueryData<Dataset>(
        datasetKeys.detail(datasetId),
      );
      const prevDatasets = queryClient.getQueryData<DatasetSparse[]>(
        datasetKeys.list(projectId),
      );

      queryClient.setQueryData<Dataset>(
        datasetKeys.detail(datasetId),
        (old) => {
          if (!old) return old;
          return { ...old, name };
        },
      );

      queryClient.setQueryData<DatasetSparse[]>(
        datasetKeys.list(projectId),
        (old) => {
          if (!old) return old;
          return old.map((ds) => (ds.id === datasetId ? { ...ds, name } : ds));
        },
      );

      return { prevDataset, prevDatasets };
    },

    onError: (_err, { datasetId }, context) => {
      if (context?.prevDataset) {
        queryClient.setQueryData(
          datasetKeys.detail(datasetId),
          context.prevDataset,
        );
      }
      if (context?.prevDatasets) {
        queryClient.setQueryData(
          datasetKeys.list(projectId),
          context.prevDatasets,
        );
      }
    },

    onSettled: (_data, _err, { datasetId }) => {
      queryClient.invalidateQueries({
        queryKey: datasetKeys.detail(datasetId),
        exact: true,
      });
      queryClient.invalidateQueries({
        queryKey: datasetKeys.list(projectId),
        exact: true,
      });
    },
  });
}

/**
 * MR-6 — sets a dataset's editable source display name with optimistic updates to
 * both the detail and list caches. The underlying filename/`name` is never sent;
 * the UI falls back to `name` when `display_name` is null.
 */
export function useUpdateDatasetDisplayName(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      datasetId,
      displayName,
    }: {
      datasetId: string;
      displayName: string;
    }) => catalog.updateDataset(datasetId, { display_name: displayName }),

    onMutate: async ({ datasetId, displayName }) => {
      await queryClient.cancelQueries({
        queryKey: datasetKeys.detail(datasetId),
      });
      await queryClient.cancelQueries({
        queryKey: datasetKeys.list(projectId),
      });

      const prevDataset = queryClient.getQueryData<Dataset>(
        datasetKeys.detail(datasetId),
      );
      const prevDatasets = queryClient.getQueryData<DatasetSparse[]>(
        datasetKeys.list(projectId),
      );

      queryClient.setQueryData<Dataset>(
        datasetKeys.detail(datasetId),
        (old) => {
          if (!old) return old;
          return { ...old, display_name: displayName };
        },
      );

      queryClient.setQueryData<DatasetSparse[]>(
        datasetKeys.list(projectId),
        (old) => {
          if (!old) return old;
          return old.map((ds) =>
            ds.id === datasetId ? { ...ds, display_name: displayName } : ds,
          );
        },
      );

      return { prevDataset, prevDatasets };
    },

    onError: (_err, { datasetId }, context) => {
      if (context?.prevDataset) {
        queryClient.setQueryData(
          datasetKeys.detail(datasetId),
          context.prevDataset,
        );
      }
      if (context?.prevDatasets) {
        queryClient.setQueryData(
          datasetKeys.list(projectId),
          context.prevDatasets,
        );
      }
    },

    onSettled: (_data, _err, { datasetId }) => {
      queryClient.invalidateQueries({
        queryKey: datasetKeys.detail(datasetId),
        exact: true,
      });
      queryClient.invalidateQueries({
        queryKey: datasetKeys.list(projectId),
        exact: true,
      });
    },
  });
}

/**
 * MR-7 — moves a source to cold storage with optimistic updates: removes the dataset from
 * the live list cache, and on settle invalidates the live list, the archived (cold-storage)
 * list, and the detail so the lineage recomputes (the archived source leaves the live graph,
 * its downstream goes orphaned) and the fridge refreshes.
 */
export function useArchiveDataset(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ datasetId }: { datasetId: string }) =>
      catalog.archiveDataset(datasetId),

    onMutate: async ({ datasetId }) => {
      await queryClient.cancelQueries({ queryKey: datasetKeys.list(projectId) });

      const prevDatasets = queryClient.getQueryData<DatasetSparse[]>(
        datasetKeys.list(projectId),
      );

      // Optimistically drop the source from the live list so the lineage recomputes.
      queryClient.setQueryData<DatasetSparse[]>(
        datasetKeys.list(projectId),
        (old) => old?.filter((ds) => ds.id !== datasetId),
      );

      return { prevDatasets };
    },

    onError: (_err, _vars, context) => {
      if (context?.prevDatasets) {
        queryClient.setQueryData(
          datasetKeys.list(projectId),
          context.prevDatasets,
        );
      }
    },

    onSettled: (_data, _err, { datasetId }) => {
      queryClient.invalidateQueries({
        queryKey: datasetKeys.list(projectId),
        exact: true,
      });
      queryClient.invalidateQueries({
        queryKey: datasetKeys.archived(projectId),
        exact: true,
      });
      queryClient.invalidateQueries({
        queryKey: datasetKeys.detail(datasetId),
        exact: true,
      });
    },
  });
}

/**
 * MR-7 — brings a source back from cold storage with optimistic updates: removes the dataset
 * from the archived list cache, and on settle invalidates the live list, the archived list,
 * and the detail so it reappears in the lineage and leaves the fridge.
 */
export function useRestoreDataset(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ datasetId }: { datasetId: string }) =>
      catalog.restoreDataset(datasetId),

    onMutate: async ({ datasetId }) => {
      await queryClient.cancelQueries({
        queryKey: datasetKeys.archived(projectId),
      });

      const prevArchived = queryClient.getQueryData<DatasetSparse[]>(
        datasetKeys.archived(projectId),
      );

      // Optimistically drop the source from the cold-storage list.
      queryClient.setQueryData<DatasetSparse[]>(
        datasetKeys.archived(projectId),
        (old) => old?.filter((ds) => ds.id !== datasetId),
      );

      return { prevArchived };
    },

    onError: (_err, _vars, context) => {
      if (context?.prevArchived) {
        queryClient.setQueryData(
          datasetKeys.archived(projectId),
          context.prevArchived,
        );
      }
    },

    onSettled: (_data, _err, { datasetId }) => {
      queryClient.invalidateQueries({
        queryKey: datasetKeys.list(projectId),
        exact: true,
      });
      queryClient.invalidateQueries({
        queryKey: datasetKeys.archived(projectId),
        exact: true,
      });
      queryClient.invalidateQueries({
        queryKey: datasetKeys.detail(datasetId),
        exact: true,
      });
    },
  });
}
