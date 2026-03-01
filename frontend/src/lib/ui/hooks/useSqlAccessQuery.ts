import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  type ApiError,
  disableSqlAccess,
  enableSqlAccess,
  type EnvironmentStatusResponse,
  getEnvironmentStatus,
  getSqlAccess,
  regenerateSqlCredentials,
  restartEnvironment,
  type SqlAccessStatus,
  startEnvironment,
  stopEnvironment,
  syncSqlAccess,
} from "@/api";

import { QUERY_STALE_TIMES } from "./queryConfig";

export const sqlAccessKeys = {
  all: ["sql-access"] as const,
  detail: (projectId: string) => ["sql-access", projectId] as const,
  status: (projectId: string) => ["sql-access", projectId, "status"] as const,
};

export function useSqlAccessQuery(projectId: string | undefined) {
  return useQuery<SqlAccessStatus, ApiError>({
    queryKey: sqlAccessKeys.detail(projectId ?? ""),
    queryFn: () => getSqlAccess(projectId!),
    enabled: Boolean(projectId),
    staleTime: QUERY_STALE_TIMES.SQL_ACCESS,
  });
}

export function useEnvironmentStatus(projectId: string | undefined) {
  return useQuery<EnvironmentStatusResponse, ApiError>({
    queryKey: sqlAccessKeys.status(projectId ?? ""),
    queryFn: () => getEnvironmentStatus(projectId!),
    refetchInterval: 15_000,
    enabled: Boolean(projectId),
  });
}

export function useEnableSqlAccess() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (projectId: string) => enableSqlAccess(projectId),
    onSuccess: (data) => {
      queryClient.setQueryData<SqlAccessStatus>(
        sqlAccessKeys.detail(data.project_id),
        data
      );
      queryClient.invalidateQueries({ queryKey: sqlAccessKeys.status(data.project_id), exact: true });
    },
  });
}

export function useDisableSqlAccess() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (projectId: string) => disableSqlAccess(projectId),
    onSuccess: (_data, projectId) => {
      queryClient.setQueryData<SqlAccessStatus>(
        sqlAccessKeys.detail(projectId),
        { project_id: projectId, enabled: false }
      );
      queryClient.invalidateQueries({ queryKey: sqlAccessKeys.status(projectId), exact: true });
    },
  });
}

export function useSyncSqlAccess() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (projectId: string) => syncSqlAccess(projectId),
    onSuccess: (data) => {
      queryClient.setQueryData<SqlAccessStatus>(
        sqlAccessKeys.detail(data.project_id),
        data
      );
      queryClient.invalidateQueries({ queryKey: sqlAccessKeys.status(data.project_id), exact: true });
    },
  });
}

export function useRegenerateSqlCredentials() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (projectId: string) => regenerateSqlCredentials(projectId),
    onSuccess: (data) => {
      queryClient.setQueryData<SqlAccessStatus>(
        sqlAccessKeys.detail(data.project_id),
        data
      );
      queryClient.invalidateQueries({ queryKey: sqlAccessKeys.status(data.project_id), exact: true });
    },
  });
}

export function useStartEnvironment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => startEnvironment(projectId),
    onSuccess: (data) => {
      queryClient.setQueryData<SqlAccessStatus>(
        sqlAccessKeys.detail(data.project_id),
        (old) => old ? { ...old, environment_status: data.environment_status } : data
      );
      queryClient.invalidateQueries({ queryKey: sqlAccessKeys.status(data.project_id), exact: true });
    },
  });
}

export function useStopEnvironment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => stopEnvironment(projectId),
    onSuccess: (data) => {
      queryClient.setQueryData<SqlAccessStatus>(
        sqlAccessKeys.detail(data.project_id),
        (old) => old ? { ...old, environment_status: data.environment_status } : data
      );
      queryClient.invalidateQueries({ queryKey: sqlAccessKeys.status(data.project_id), exact: true });
    },
  });
}

export function useRestartEnvironment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => restartEnvironment(projectId),
    onSuccess: (data) => {
      queryClient.setQueryData<SqlAccessStatus>(
        sqlAccessKeys.detail(data.project_id),
        (old) => old ? { ...old, environment_status: data.environment_status } : data
      );
      queryClient.invalidateQueries({ queryKey: sqlAccessKeys.status(data.project_id), exact: true });
    },
  });
}
