import { useQuery } from "@tanstack/react-query";

import { type ApiError, get, listProjects, type Project } from "@/api";

interface OrgInfo {
  id: string;
  name: string;
}

export const orgKeys = {
  me: ["org", "me"] as const,
  projects: ["org", "projects"] as const,
};

export function useOrgQuery() {
  return useQuery<OrgInfo, ApiError>({
    queryKey: orgKeys.me,
    queryFn: () => get<OrgInfo>("/api/orgs/me"),
  });
}

export function useOrgProjectsQuery() {
  return useQuery<Project[], ApiError>({
    queryKey: orgKeys.projects,
    queryFn: () => listProjects(),
  });
}
