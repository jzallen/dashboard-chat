import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { withAuth } from "@/auth";
import {
  type ApiError,
  createDataCatalog,
  type SqlAccessStatus,
} from "@/dataCatalog";

import { QUERY_STALE_TIMES } from "./queryConfig";
import { sqlAccessKeys } from "./queryKeys";

export { sqlAccessKeys };

const catalog = createDataCatalog(withAuth(fetch));

/** Fetches the SQL access status (credentials, connection info, sync status) for a project. */
export function useSqlAccessQuery(projectId: string | undefined) {
  return useQuery<SqlAccessStatus, ApiError>({
    queryKey: sqlAccessKeys.detail(projectId ?? ""),
    queryFn: () => catalog.getSqlAccess(projectId!),
    enabled: Boolean(projectId),
    staleTime: QUERY_STALE_TIMES.SQL_ACCESS,
    refetchInterval: 15_000,
  });
}

/** Enables SQL access for a project and updates the query cache on success. */
export function useEnableSqlAccess() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (projectId: string) => catalog.enableSqlAccess(projectId),
    onSuccess: (data) => {
      queryClient.setQueryData<SqlAccessStatus>(
        sqlAccessKeys.detail(data.project_id),
        data,
      );
    },
  });
}

/** Disables SQL access for a project and clears cached credentials. */
export function useDisableSqlAccess() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (projectId: string) => catalog.disableSqlAccess(projectId),
    onSuccess: (_data, projectId) => {
      queryClient.setQueryData<SqlAccessStatus>(
        sqlAccessKeys.detail(projectId),
        { project_id: projectId, enabled: false },
      );
    },
  });
}

/** Syncs dataset schemas to the query engine and refreshes cached status. */
export function useSyncSqlAccess() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (projectId: string) => catalog.syncSqlAccess(projectId),
    onSuccess: (_data, projectId) => {
      queryClient.invalidateQueries({
        queryKey: sqlAccessKeys.detail(projectId),
      });
    },
  });
}

/** Regenerates SQL credentials (new proxy role password) and updates cached status. */
export function useRegenerateSqlCredentials() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (projectId: string) =>
      catalog.regenerateSqlCredentials(projectId),
    onSuccess: (data) => {
      queryClient.setQueryData<SqlAccessStatus>(
        sqlAccessKeys.detail(data.project_id),
        data,
      );
    },
  });
}
