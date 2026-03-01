import { useQuery } from "@tanstack/react-query";

import { type ApiError, getProject, type Project } from "@/api";

import { QUERY_STALE_TIMES } from "./queryConfig";

/** TanStack Query key factory for project queries. */
export const projectKeys = {
  all: ["projects"] as const,
  detail: (id: string) => ["projects", id] as const,
};

/** Fetches and caches the project by ID. */
export function useProjectQuery(projectId: string) {
  return useQuery<Project, ApiError>({
    queryKey: projectKeys.detail(projectId),
    queryFn: () => getProject(projectId),
    enabled: Boolean(projectId),
    staleTime: QUERY_STALE_TIMES.PROJECT,
  });
}
