import { useQuery } from "@tanstack/react-query";

import { type ApiError, get, listProjects, type Project } from "@/api";

interface OrgInfo {
  id: string;
  name: string;
}

/** TanStack Query key factory for org-level queries. */
export const orgKeys = {
  me: ["org", "me"] as const,
  projects: ["org", "projects"] as const,
};

/** Fetches the current user's organization info. */
export function useOrgQuery() {
  return useQuery<OrgInfo, ApiError>({
    queryKey: orgKeys.me,
    queryFn: () => get<OrgInfo>("/api/orgs/me"),
  });
}

/** Fetches all projects belonging to the current org. */
export function useOrgProjectsQuery() {
  return useQuery<Project[], ApiError>({
    queryKey: orgKeys.projects,
    queryFn: () => listProjects(),
  });
}
