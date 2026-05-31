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
 *
 * RED scaffold (DISTILL) — body throws until DELIVER step 06-02 implements it.
 */
export function useUpdateDatasetDisplayName(_projectId: string) {
  throw new Error(
    "Not yet implemented — RED scaffold useUpdateDatasetDisplayName",
  );
}
