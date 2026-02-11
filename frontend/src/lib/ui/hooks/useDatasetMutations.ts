import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateDataset, type Dataset, type Project } from "@/api";
import { projectKeys } from "./useProjectQuery";
import { datasetKeys } from "./useDatasetQuery";

export function useRenameDataset(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ datasetId, name }: { datasetId: string; name: string }) =>
      updateDataset(datasetId, { name }),

    onMutate: async ({ datasetId, name }) => {
      await queryClient.cancelQueries({ queryKey: projectKeys.detail(projectId) });
      await queryClient.cancelQueries({ queryKey: datasetKeys.detail(datasetId) });

      const prevProject = queryClient.getQueryData<Project>(projectKeys.detail(projectId));
      const prevDataset = queryClient.getQueryData<Dataset>(datasetKeys.detail(datasetId));

      queryClient.setQueryData<Project>(projectKeys.detail(projectId), (old) => {
        if (!old) return old;
        return {
          ...old,
          datasets: old.datasets.map((ds) =>
            ds.id === datasetId ? { ...ds, name } : ds
          ),
        };
      });

      queryClient.setQueryData<Dataset>(datasetKeys.detail(datasetId), (old) => {
        if (!old) return old;
        return { ...old, name };
      });

      return { prevProject, prevDataset };
    },

    onError: (_err, { datasetId }, context) => {
      if (context?.prevProject) {
        queryClient.setQueryData(projectKeys.detail(projectId), context.prevProject);
      }
      if (context?.prevDataset) {
        queryClient.setQueryData(datasetKeys.detail(datasetId), context.prevDataset);
      }
    },

    onSettled: (_data, _err, { datasetId }) => {
      queryClient.invalidateQueries({ queryKey: datasetKeys.detail(datasetId) });
    },
  });
}
