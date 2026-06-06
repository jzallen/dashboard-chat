/**
 * metadataApiSource — a backend-backed {@link PartialCatalogSource} for PROJECT
 * reads (slice 1) plus the LINEAGE CORE (slice 2), now SCOPED TO THE PATH PROJECT
 * (slice 3 — project-in-path). It implements `getProjects` (org-global),
 * `getCurrentProject`, and the three lineage getters (`getNodes`/`getEdges`/
 * `getAudit`); every other catalog payload stays on the fallback (the fixture
 * today). It NEVER references the fallback.
 *
 * The backend has no lineage endpoint, so the graph is DERIVED client-side: the
 * SCOPED project's datasets, views, and reports are fetched once PER PROJECT
 * (memoized in a `Map<pid, Promise<…>>`) and mapped to nodes/edges by
 * {@link import("./lineageMappers")}. `getAudit` resolves `{}` (no backend
 * narrative).
 *
 * Scoping: the active project id is injected via `deps.getProjectId` (like
 * `deps.getToken`), so `lib/catalog` stays router-free. The scoped getters target
 * `deps.getProjectId() ?? firstPid` — the `?? firstPid` only covers the
 * pre-first-paint instant before the `/project/:projectId` layout loader runs
 * `selectProject`. `getCurrentProject` returns the project matching the scoped
 * pid (looked up in the fetched list), NOT `projects[0]`. `getProjects` stays
 * org-global (unaffected by the scope).
 *
 * Token decoupling: the auth token-getter is injected via `deps.getToken`, so
 * this module stays free of any `ui/src/auth` import — `lib/catalog` is pure.
 *
 * Failure vs. emptiness (the fallback contract): a fetch/auth ERROR rejects, so
 * {@link createDataCatalog} keeps the seeded fixtures (no crash). A LEGITIMATELY
 * EMPTY backend resolves normally — `getProjects` → `[]`, `getNodes` → `{}`,
 * `getEdges` → `[]` — so the graph rebuilds blank (correct onboarding state).
 * `getCurrentProject` is the one exception: `CurrentProject` is non-nullable, so
 * it still throws when there is no scoped (or first) project (an empty-shell
 * state is a separate follow-up).
 */
import type { AuditEntry, Edge, LineageNode } from "../lineage";
import type { CurrentProject, ProjectSummary } from "../models";
import { apiGet } from "./backendClient";
import type {
  BackendDataset,
  BackendReport,
  BackendView,
} from "./lineageMappers";
import { toLineageGraph } from "./lineageMappers";
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
  /**
   * Returns the currently scoped project id (the `/project/:projectId` path
   * segment), or undefined before the layout loader has run `selectProject`.
   * Injected like {@link getToken} so `lib/catalog` stays router-free.
   */
  getProjectId?: () => string | undefined;
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
  // Memoize the project fetch (the PROMISE, not the value) so getProjects,
  // getCurrentProject, and the lineage bundle share a single round-trip.
  let projectsPromise: Promise<BackendProject[]> | undefined;
  const fetchProjects = () =>
    (projectsPromise ??= apiGet<BackendProject[]>(
      "/api/projects",
      deps.getToken(),
    ));

  /**
   * The project id to scope reads to: the injected path project, falling back to
   * the FIRST project only for the pre-first-paint instant (before the layout
   * loader runs `selectProject`). Throws if neither is available.
   */
  const scopedProjectId = async (): Promise<string> => {
    const injected = deps.getProjectId?.();
    if (injected) return injected;
    const projects = await fetchProjects();
    const first = projects[0];
    if (!first) {
      throw new Error("No current project available from /api/projects");
    }
    return first.id;
  };

  // Memoize the three lineage list fetches PER PROJECT (the PROMISE, keyed by the
  // scoped pid) so getNodes and getEdges — which client.ts calls separately —
  // share one round of fetches per project, while different projects coexist (a
  // re-scope to B keeps A's bundle, and a switch back to A reuses it).
  const lineageBundlesByPid = new Map<
    string,
    Promise<{ nodes: Record<string, LineageNode>; edges: Edge[] }>
  >();
  const fetchLineageBundle = async () => {
    const pid = await scopedProjectId();
    let bundle = lineageBundlesByPid.get(pid);
    if (!bundle) {
      bundle = (async () => {
        const tok = deps.getToken();
        const [datasets, views, reports] = await Promise.all([
          apiGet<BackendDataset[]>(
            `/api/datasets?project_id=${encodeURIComponent(pid)}`,
            tok,
          ),
          apiGet<BackendView[]>(
            `/api/projects/${encodeURIComponent(pid)}/views`,
            tok,
          ),
          apiGet<BackendReport[]>(
            `/api/projects/${encodeURIComponent(pid)}/reports`,
            tok,
          ),
        ]);
        return toLineageGraph(datasets, views, reports);
      })();
      lineageBundlesByPid.set(pid, bundle);
    }
    return bundle;
  };

  return {
    async getProjects(): Promise<ProjectSummary[]> {
      const projects = await fetchProjects();
      // Resolve even when empty — an empty backend means an empty picker, which
      // reflects reality (the fallback is for errors, not emptiness).
      return projects.map(toProjectSummary);
    },

    async getCurrentProject(): Promise<CurrentProject> {
      const projects = await fetchProjects();
      const pid = await scopedProjectId();
      const scoped = projects.find((p) => p.id === pid) ?? projects[0];
      if (!scoped) {
        throw new Error("No current project available from /api/projects");
      }
      return {
        id: scoped.id,
        name: scoped.name,
        description: scoped.description ?? "",
      };
    },

    async getNodes(): Promise<Record<string, LineageNode>> {
      // Resolves `{}` when the backend is legitimately empty (no throw) — a
      // blank canvas is the correct onboarding state. Rejects only on a real
      // fetch/auth error (apiGet throws on non-2xx → fixtures kept upstream).
      return (await fetchLineageBundle()).nodes;
    },

    async getEdges(): Promise<Edge[]> {
      return (await fetchLineageBundle()).edges;
    },

    async getAudit(): Promise<Record<string, AuditEntry[]>> {
      // No backend audit narrative — resolve empty so the folded audit is clean.
      return {};
    },
  };
}
