import { useQuery, useQueryClient } from "@tanstack/react-query";

import { type DatasetSparse,getProject, type Project } from "@/api";

export const projectKeys = {
  all: ["projects"] as const,
  detail: (id: string) => ["projects", id] as const,
};

export function useProjectQuery(projectId: string) {
  return useQuery({
    queryKey: projectKeys.detail(projectId),
    queryFn: () => getProject(projectId),
    enabled: Boolean(projectId),
  });
}

export function useUpdateProjectDatasetCache(projectId: string) {
  const queryClient = useQueryClient();

  return {
    updateDatasetInProject: (datasetId: string, patch: Partial<DatasetSparse>) => {
      queryClient.setQueryData<Project>(projectKeys.detail(projectId), (old) => {
        if (!old) return old;
        return {
          ...old,
          datasets: old.datasets.map((ds) =>
            ds.id === datasetId ? { ...ds, ...patch } : ds
          ),
        };
      });
    },
    addDatasetToProject: (sparse: DatasetSparse) => {
      queryClient.setQueryData<Project>(projectKeys.detail(projectId), (old) => {
        if (!old) return old;
        return { ...old, datasets: [...old.datasets, sparse] };
      });
    },
  };
}
