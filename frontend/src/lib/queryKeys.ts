/** TanStack Query key factory for project queries. */
export const projectKeys = {
  all: ["projects"] as const,
  detail: (id: string) => ["projects", id] as const,
};

/** TanStack Query key factory for dataset queries (list and detail). */
export const datasetKeys = {
  all: ["datasets"] as const,
  lists: () => [...datasetKeys.all, "list"] as const,
  list: (projectId: string) => [...datasetKeys.lists(), projectId] as const,
  detail: (id: string) => ["datasets", id] as const,
};

/** TanStack Query key factory for org-level queries. */
export const orgKeys = {
  me: ["org", "me"] as const,
  projects: ["org", "projects"] as const,
};

/** TanStack Query key factory for SQL access queries. */
export const sqlAccessKeys = {
  all: ["sql-access"] as const,
  detail: (projectId: string) => ["sql-access", projectId] as const,
  status: (projectId: string) => ["sql-access", projectId, "status"] as const,
};
