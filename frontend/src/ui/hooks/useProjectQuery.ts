import { useQuery } from "@tanstack/react-query";

import { withAuth } from "@/auth";
import { type ApiError, createDataCatalog, type Project } from "@/dataCatalog";

import { QUERY_STALE_TIMES } from "./queryConfig";
import { projectKeys } from "./queryKeys";

export { projectKeys };

const catalog = createDataCatalog(withAuth(fetch));

/** Fetches and caches the project by ID. */
export function useProjectQuery(projectId: string) {
  return useQuery<Project, ApiError>({
    queryKey: projectKeys.detail(projectId),
    queryFn: () => catalog.getProject(projectId),
    enabled: Boolean(projectId),
    staleTime: QUERY_STALE_TIMES.PROJECT,
  });
}
