import { useQuery } from "@tanstack/react-query";

import { withAuth } from "@/auth";
import { type ApiError, createDataCatalog, type Project } from "@/dataCatalog";

import { QUERY_STALE_TIMES } from "./queryConfig";

const catalog = createDataCatalog(withAuth(fetch));

/** TanStack Query key factory for project queries. */
export const projectKeys = {
  all: ["projects"] as const,
  detail: (id: string) => ["projects", id] as const,
};

/** Fetches and caches the project by ID. */
export function useProjectQuery(projectId: string) {
  return useQuery<Project, ApiError>({
    queryKey: projectKeys.detail(projectId),
    queryFn: () => catalog.getProject(projectId),
    enabled: Boolean(projectId),
    staleTime: QUERY_STALE_TIMES.PROJECT,
  });
}
