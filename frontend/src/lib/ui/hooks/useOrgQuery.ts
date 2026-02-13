import { useQuery } from "@tanstack/react-query";
import { get, listProjects, type Project } from "@/api";

interface OrgInfo {
  id: string;
  name: string;
}

export const orgKeys = {
  me: ["org", "me"] as const,
  projects: ["org", "projects"] as const,
};

export function useOrgQuery() {
  return useQuery({
    queryKey: orgKeys.me,
    queryFn: () => get<OrgInfo>("/api/orgs/me"),
  });
}

export function useOrgProjectsQuery() {
  return useQuery<Project[]>({
    queryKey: orgKeys.projects,
    queryFn: () => listProjects(),
  });
}
