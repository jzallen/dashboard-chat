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
  /** MR-7: the cold-storage (archived-only) list for a project. */
  archived: (projectId: string) =>
    [...datasetKeys.lists(), projectId, "archived"] as const,
  detail: (id: string) => ["datasets", id] as const,
};

/** TanStack Query key factory for org-level queries. */
export const orgKeys = {
  me: ["org", "me"] as const,
  projects: ["org", "projects"] as const,
};

/** TanStack Query key factory for view queries. */
export const viewKeys = {
  all: ["views"] as const,
  lists: () => [...viewKeys.all, "list"] as const,
  list: (projectId: string) => [...viewKeys.lists(), projectId] as const,
  details: () => [...viewKeys.all, "detail"] as const,
  detail: (id: string) => [...viewKeys.details(), id] as const,
};

/** TanStack Query key factory for report queries. */
export const reportKeys = {
  all: ["reports"] as const,
  lists: () => [...reportKeys.all, "list"] as const,
  list: (projectId: string) => [...reportKeys.lists(), projectId] as const,
  details: () => [...reportKeys.all, "detail"] as const,
  detail: (id: string) => [...reportKeys.details(), id] as const,
};

/** TanStack Query key factory for SQL access queries. */
export const sqlAccessKeys = {
  all: ["sql-access"] as const,
  detail: (projectId: string) => ["sql-access", projectId] as const,
  status: (projectId: string) => ["sql-access", projectId, "status"] as const,
};

/** TanStack Query key factory for project memory queries. */
export const memoryKeys = {
  all: ["memories"] as const,
  detail: (projectId: string) => ["memories", projectId] as const,
};

/** TanStack Query key factory for session queries. */
export const sessionKeys = {
  all: ["sessions"] as const,
  lists: () => [...sessionKeys.all, "list"] as const,
  list: (projectId: string) => [...sessionKeys.lists(), projectId] as const,
  detail: (sessionId: string) => [...sessionKeys.all, sessionId] as const,
};

/** TanStack Query key factory for query engine queries. */
export const queryEngineKeys = {
  all: ["query-engines"] as const,
  list: () => [...queryEngineKeys.all, "list"] as const,
  detail: (id: string) => ["query-engines", id] as const,
};
