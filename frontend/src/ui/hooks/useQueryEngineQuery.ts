import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { withAuth } from "@/auth";
import {
  type ApiError,
  createDataCatalog,
  type QueryEngineDetail,
  type QueryEngineNode,
  type QueryEngineTestResult,
} from "@/dataCatalog";

import { QUERY_STALE_TIMES } from "./queryConfig";
import { queryEngineKeys } from "./queryKeys";

const catalog = createDataCatalog(withAuth(fetch));

/** Fetches all query engine nodes for the current org. Polls every 30s. */
export function useQueryEnginesQuery() {
  return useQuery<QueryEngineNode[], ApiError>({
    queryKey: queryEngineKeys.list(),
    queryFn: () => catalog.listQueryEngines(),
    staleTime: QUERY_STALE_TIMES.SQL_ACCESS,
    refetchInterval: 30_000,
  });
}

/** Fetches a single query engine node detail. Polls every 15s. */
export function useQueryEngineDetailQuery(nodeId: string | undefined) {
  return useQuery<QueryEngineDetail, ApiError>({
    queryKey: queryEngineKeys.detail(nodeId ?? ""),
    queryFn: () => catalog.getQueryEngine(nodeId!),
    enabled: Boolean(nodeId),
    staleTime: QUERY_STALE_TIMES.SQL_ACCESS,
    refetchInterval: 15_000,
  });
}

/** Tests connectivity to a query engine node. */
export function useTestQueryEngine() {
  const queryClient = useQueryClient();

  return useMutation<QueryEngineTestResult, ApiError, string>({
    mutationFn: (nodeId: string) => catalog.testQueryEngine(nodeId),
    onSuccess: (_data, nodeId) => {
      queryClient.invalidateQueries({
        queryKey: queryEngineKeys.detail(nodeId),
      });
    },
  });
}
