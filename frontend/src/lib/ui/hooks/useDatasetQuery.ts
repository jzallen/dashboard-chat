import { useQuery, useQueryClient } from "@tanstack/react-query";

import { getDataset } from "@/api";

export const datasetKeys = {
  all: ["datasets"] as const,
  detail: (id: string) => ["datasets", id] as const,
};

export function useDatasetQuery(datasetId: string | undefined) {
  return useQuery({
    queryKey: datasetKeys.detail(datasetId!),
    queryFn: () => getDataset(datasetId!, { includeTransforms: true, includePreview: true, previewLimit: 100 }),
    enabled: Boolean(datasetId),
  });
}

/**
 * Returns a function that prefetches a dataset into the query cache.
 * Call on card selection so table-mode data is ready before the user toggles.
 */
export function usePrefetchDataset() {
  const queryClient = useQueryClient();

  return (datasetId: string) => {
    queryClient.prefetchQuery({
      queryKey: datasetKeys.detail(datasetId),
      queryFn: () => getDataset(datasetId, { includeTransforms: true, includePreview: true, previewLimit: 100 }),
      staleTime: 5 * 60 * 1000,
    });
  };
}
