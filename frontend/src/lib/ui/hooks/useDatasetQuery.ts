import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { withAuth } from "@/auth";
import {
  type ApiError,
  createDataCatalog,
  type Dataset,
  type DatasetSparse,
} from "@/dataCatalog";

import { QUERY_STALE_TIMES } from "./queryConfig";

const catalog = createDataCatalog(withAuth(fetch));

/** TanStack Query key factory for dataset queries (list and detail). */
export const datasetKeys = {
  all: ["datasets"] as const,
  lists: () => [...datasetKeys.all, "list"] as const,
  list: (projectId: string) => [...datasetKeys.lists(), projectId] as const,
  detail: (id: string) => ["datasets", id] as const,
};

/** Fetches a full dataset by ID, including transforms and preview rows. */
export function useDatasetQuery(datasetId: string | undefined) {
  return useQuery<Dataset, ApiError>({
    queryKey: datasetKeys.detail(datasetId ?? ""),
    queryFn: () =>
      catalog.getDataset(datasetId!, {
        includeTransforms: true,
        includePreview: true,
        previewLimit: 100,
      }),
    enabled: Boolean(datasetId),
  });
}

/** Fetches the sparse dataset list for a project (names and IDs only). */
export function useDatasets(projectId: string | undefined) {
  return useQuery<DatasetSparse[], ApiError>({
    queryKey: datasetKeys.list(projectId ?? ""),
    queryFn: () => catalog.listDatasetsForProject(projectId!),
    enabled: Boolean(projectId),
    staleTime: QUERY_STALE_TIMES.DATASET_LIST,
    placeholderData: keepPreviousData,
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
      queryFn: () =>
        catalog.getDataset(datasetId, {
          includeTransforms: true,
          includePreview: true,
          previewLimit: 100,
        }),
      staleTime: QUERY_STALE_TIMES.DATASET_DETAIL,
    });
  };
}
