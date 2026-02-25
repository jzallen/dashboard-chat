import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getSqlAccess,
  enableSqlAccess,
  disableSqlAccess,
  syncSqlAccess,
  regenerateSqlCredentials,
  type SqlAccessStatus,
} from "@/api";

export const sqlAccessKeys = {
  all: ["sql-access"] as const,
  detail: (projectId: string) => ["sql-access", projectId] as const,
};

export function useSqlAccessQuery(projectId: string | undefined) {
  return useQuery({
    queryKey: sqlAccessKeys.detail(projectId!),
    queryFn: () => getSqlAccess(projectId!),
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
    },
  });
}
