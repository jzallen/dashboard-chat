import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { withAuth } from "@/auth";
import {
  type ApiError,
  createDataCatalog,
  type EnvironmentStatusResponse,
  type SqlAccessStatus,
} from "@/dataCatalog";

import { QUERY_STALE_TIMES } from "./queryConfig";

const catalog = createDataCatalog(withAuth(fetch));

/** TanStack Query key factory for SQL access queries. */
export const sqlAccessKeys = {
  all: ["sql-access"] as const,
  detail: (projectId: string) => ["sql-access", projectId] as const,
  status: (projectId: string) => ["sql-access", projectId, "status"] as const,
};

/** Fetches the SQL access status (credentials, connection info) for a project. */
export function useSqlAccessQuery(projectId: string | undefined) {
  return useQuery<SqlAccessStatus, ApiError>({
    queryKey: sqlAccessKeys.detail(projectId ?? ""),
    queryFn: () => catalog.getSqlAccess(projectId!),
    enabled: Boolean(projectId),
    staleTime: QUERY_STALE_TIMES.SQL_ACCESS,
  });
}

/** Polls the SQL environment status (running, stopped, error) every 15 seconds. */
export function useEnvironmentStatus(projectId: string | undefined) {
  return useQuery<EnvironmentStatusResponse, ApiError>({
    queryKey: sqlAccessKeys.status(projectId ?? ""),
    queryFn: () => catalog.getEnvironmentStatus(projectId!),
    refetchInterval: 15_000,
    enabled: Boolean(projectId),
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
      queryClient.invalidateQueries({
        queryKey: sqlAccessKeys.status(data.project_id),
        exact: true,
      });
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
      queryClient.invalidateQueries({
        queryKey: sqlAccessKeys.status(projectId),
        exact: true,
      });
    },
  });
}

/** Syncs dataset schemas to the SQL environment and refreshes cached status. */
export function useSyncSqlAccess() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (projectId: string) => catalog.syncSqlAccess(projectId),
    onSuccess: (data) => {
      queryClient.setQueryData<SqlAccessStatus>(
        sqlAccessKeys.detail(data.project_id),
        data,
      );
      queryClient.invalidateQueries({
        queryKey: sqlAccessKeys.status(data.project_id),
        exact: true,
      });
    },
  });
}

/** Regenerates SQL credentials (new password) and updates cached status. */
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
      queryClient.invalidateQueries({
        queryKey: sqlAccessKeys.status(data.project_id),
        exact: true,
      });
    },
  });
}

/** Starts the SQL environment and updates the environment status in cache. */
export function useStartEnvironment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => catalog.startEnvironment(projectId),
    onSuccess: (data) => {
      queryClient.setQueryData<SqlAccessStatus>(
        sqlAccessKeys.detail(data.project_id),
        (old) =>
          old ? { ...old, environment_status: data.environment_status } : data,
      );
      queryClient.invalidateQueries({
        queryKey: sqlAccessKeys.status(data.project_id),
        exact: true,
      });
    },
  });
}

/** Stops the SQL environment and updates the environment status in cache. */
export function useStopEnvironment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => catalog.stopEnvironment(projectId),
    onSuccess: (data) => {
      queryClient.setQueryData<SqlAccessStatus>(
        sqlAccessKeys.detail(data.project_id),
        (old) =>
          old ? { ...old, environment_status: data.environment_status } : data,
      );
      queryClient.invalidateQueries({
        queryKey: sqlAccessKeys.status(data.project_id),
        exact: true,
      });
    },
  });
}

/** Restarts the SQL environment and updates the environment status in cache. */
export function useRestartEnvironment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => catalog.restartEnvironment(projectId),
    onSuccess: (data) => {
      queryClient.setQueryData<SqlAccessStatus>(
        sqlAccessKeys.detail(data.project_id),
        (old) =>
          old ? { ...old, environment_status: data.environment_status } : data,
      );
      queryClient.invalidateQueries({
        queryKey: sqlAccessKeys.status(data.project_id),
        exact: true,
      });
    },
  });
}
