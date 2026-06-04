/**
 * metadataApiSource — a backend-backed {@link PartialCatalogSource} for PROJECT
 * reads (slice 1). It implements only `getProjects` and `getCurrentProject`,
 * fetching `GET /api/projects` through {@link apiGet}; every other catalog payload
 * stays on the fallback (the fixture today). It NEVER references the fallback.
 *
 * Token decoupling: the auth token-getter is injected via `deps.getToken`, so
 * this module stays free of any `ui/src/auth` import — `lib/catalog` is pure.
 *
 * Failure is the fallback's cue: a fetch error or an empty project list rejects,
 * so {@link createDataCatalog} keeps the fixture projects showing (no flash to
 * empty, no crash).
 */
import type { CurrentProject, ProjectSummary } from "../models";
import { apiGet } from "./backendClient";
import type { PartialCatalogSource } from "./source";

/** A project resource as the backend returns it (post envelope-unwrap). */
interface BackendProject {
  id: string;
  name: string;
  description?: string | null;
  datasets?: unknown[];
}

/** Dependencies the source needs from the app — kept minimal and injected. */
export interface MetadataApiSourceDeps {
  /** Returns the current auth token (or null when unauthenticated). */
  getToken: () => string | null;
}

/**
 * Map a backend project to the catalog's project-list DTO. `models` is 0 until a
 * later slice backs it; `datasets` is the count of attached datasets.
 */
function toProjectSummary(project: BackendProject): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    desc: project.description ?? "",
    datasets: project.datasets?.length ?? 0,
    models: 0,
  };
}

export function metadataApiSource(
  deps: MetadataApiSourceDeps,
): PartialCatalogSource {
  const fetchProjects = () =>
    apiGet<BackendProject[]>("/api/projects", deps.getToken());

  return {
    async getProjects(): Promise<ProjectSummary[]> {
      const projects = await fetchProjects();
      if (!projects.length) {
        throw new Error("No projects returned from /api/projects");
      }
      return projects.map(toProjectSummary);
    },

    async getCurrentProject(): Promise<CurrentProject> {
      const projects = await fetchProjects();
      const first = projects[0];
      if (!first) {
        throw new Error("No current project available from /api/projects");
      }
      return {
        id: first.id,
        name: first.name,
        description: first.description ?? "",
      };
    },
  };
}
