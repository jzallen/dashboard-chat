import { useQuery } from "@tanstack/react-query";

import { withAuth } from "@/auth";
import {
  type ApiError,
  createDataCatalog,
  type OrgInfo,
  type Project,
} from "@/dataCatalog";

const catalog = createDataCatalog(withAuth(fetch));

/** TanStack Query key factory for org-level queries. */
export const orgKeys = {
  me: ["org", "me"] as const,
  projects: ["org", "projects"] as const,
};

/** Fetches the current user's organization info. */
export function useOrgQuery() {
  return useQuery<OrgInfo, ApiError>({
    queryKey: orgKeys.me,
    queryFn: () => catalog.getOrgInfo(),
  });
}

/** Fetches all projects belonging to the current org. */
export function useOrgProjectsQuery() {
  return useQuery<Project[], ApiError>({
    queryKey: orgKeys.projects,
    queryFn: () => catalog.listProjects(),
  });
}
