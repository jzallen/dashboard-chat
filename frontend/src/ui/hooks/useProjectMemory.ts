import { useQuery } from "@tanstack/react-query";

import { withAuth } from "@/auth";
import { type ApiError, createDataCatalog, type ProjectMemory } from "@/dataCatalog";

import { QUERY_STALE_TIMES } from "./queryConfig";
import { memoryKeys } from "./queryKeys";

export { memoryKeys };

const catalog = createDataCatalog(withAuth(fetch));

/** Fetches and caches the project memory by project ID. */
export function useProjectMemory(projectId: string | undefined) {
  return useQuery<ProjectMemory, ApiError>({
    queryKey: memoryKeys.detail(projectId ?? ""),
    queryFn: () => catalog.getProjectMemory(projectId!),
    enabled: Boolean(projectId),
    staleTime: QUERY_STALE_TIMES.MEMORY,
  });
}
