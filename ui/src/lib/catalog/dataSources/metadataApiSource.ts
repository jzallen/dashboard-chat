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
import type { AuditEntry, AuditTag, Edge, Layer, LineageNode } from "../lineage";
import type {
  ChatHistoryItem,
  CurrentProject,
  DbtFile,
  OrgMember,
  OrgSettings,
  ProjectSummary,
} from "../models";
import { apiGet, apiPatch } from "./backendClient";
import type {
  BackendDataset,
  BackendReport,
  BackendView,
} from "./lineageMappers";
import { toLineageGraph } from "./lineageMappers";
import type { BackendSession } from "./sessionMappers";
import { toChatHistoryItem } from "./sessionMappers";
import type { PartialCatalogSource } from "./source";

/** A project resource as the backend returns it (post envelope-unwrap). */
interface BackendProject {
  id: string;
  name: string;
  description?: string | null;
  datasets?: unknown[];
}

/**
 * The org-settings resource as the backend returns it (post envelope-unwrap):
 * snake_case attributes, flat alongside the resource `id`. Mapped to the
 * camelCase {@link OrgSettings} by {@link toOrgSettings}.
 */
interface BackendOrg {
  id: string;
  name: string;
  slug: string;
  region: string;
  plan: string;
  seats: number;
  used_seats: number;
  created_at: string;
  members: OrgMember[];
  defaults: { engine: string; materialization: string; model_prefix: string };
}

/** Map the backend org payload (snake_case) to the catalog's {@link OrgSettings}. */
function toOrgSettings(org: BackendOrg): OrgSettings {
  return {
    name: org.name,
    slug: org.slug,
    region: org.region,
    plan: org.plan,
    seats: org.seats,
    usedSeats: org.used_seats,
    created: org.created_at,
    members: org.members,
    defaults: {
      engine: org.defaults.engine,
      materialization: org.defaults.materialization,
      modelPrefix: org.defaults.model_prefix,
    },
  };
}

/**
 * The dbt manifest resource as the backend returns it (post envelope-unwrap):
 * the file index plus the extra `project_name`/`layer_counts` the current
 * {@link DbtFile} consumer ignores. Mapped to `DbtFile[]` by {@link toDbtFiles}.
 */
interface BackendDbtManifest {
  id: string;
  project_name?: string;
  layer_counts?: Record<string, number>;
  files: { path: string; layer: Layer | "config"; ref?: string }[];
}

/** Map the backend manifest payload to the catalog's `DbtFile[]` (files only, 1:1). */
function toDbtFiles(manifest: BackendDbtManifest): DbtFile[] {
  return (manifest.files ?? []).map((f) => ({
    path: f.path,
    layer: f.layer,
    ref: f.ref,
  }));
}

/**
 * An assistant-audit row as the backend returns it (post envelope-unwrap): the
 * entry `id` flattened alongside the snake_case attributes from
 * `GET /api/projects/{pid}/audit`. `tool`/`say`/`tag` come from the entry's JSON
 * payload; `transform_id`/`enabled` from the reversed-FK join (`null` for
 * log-only entries). Grouped by `node_id` + mapped to {@link AuditEntry} by
 * {@link toAuditByNode}.
 */
interface BackendAuditEntry {
  id: string;
  node_id: string;
  node_kind: string;
  tool: string;
  say: string;
  tag: AuditTag;
  transform_id?: string | null;
  enabled?: boolean | null;
}

/**
 * Fold a flat audit-entry list into the `Record<nodeId, AuditEntry[]>` shape the
 * graph expects, preserving the backend's `(node_id, sequence, created_at)`
 * order within each node. snake_case → camelCase at the boundary.
 */
function toAuditByNode(
  entries: BackendAuditEntry[],
): Record<string, AuditEntry[]> {
  const byNode: Record<string, AuditEntry[]> = {};
  for (const entry of entries) {
    (byNode[entry.node_id] ??= []).push({
      tool: entry.tool,
      say: entry.say,
      tag: entry.tag,
      auditEntryId: entry.id,
      transformId: entry.transform_id,
      enabled: entry.enabled ?? undefined,
    });
  }
  return byNode;
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

  // Memoize the project-sessions fetch PER PROJECT (the PROMISE, keyed by the
  // scoped pid) so getRecents and getAllChats — which client.ts calls separately
  // — share one round-trip per project, while different projects coexist.
  const sessionsByPid = new Map<string, Promise<BackendSession[]>>();
  const fetchSessions = async (): Promise<BackendSession[]> => {
    const pid = await scopedProjectId();
    let sessions = sessionsByPid.get(pid);
    if (!sessions) {
      sessions = apiGet<BackendSession[]>(
        `/api/projects/${encodeURIComponent(pid)}/sessions`,
        deps.getToken(),
      );
      sessionsByPid.set(pid, sessions);
    }
    return sessions;
  };

  /** A session's effective recency timestamp (last activity, else creation). */
  const recencyOf = (session: BackendSession): number =>
    Date.parse(session.last_active_at ?? session.created_at ?? "") || 0;

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

    async getOrg(): Promise<OrgSettings> {
      // Org-global (not project-scoped). The org always exists for an
      // authenticated user, so no empty-guard is needed; a fetch/auth error
      // rejects (apiGet throws on non-2xx) → the catalog keeps its fixtures.
      const org = await apiGet<BackendOrg>("/api/orgs/me", deps.getToken());
      return toOrgSettings(org);
    },

    async getDbtFiles(): Promise<DbtFile[]> {
      // Project-scoped (a per-project dbt manifest), mirroring the lineage/
      // sessions getters: scope to the injected pid, falling back to the first
      // project only for the pre-first-paint instant. Resolves the (possibly
      // empty) file list; rejects only on a fetch/auth error (apiGet throws on
      // non-2xx → the catalog keeps its fixtures).
      const pid = await scopedProjectId();
      const manifest = await apiGet<BackendDbtManifest>(
        `/api/projects/${encodeURIComponent(pid)}/export/dbt/manifest`,
        deps.getToken(),
      );
      return toDbtFiles(manifest);
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
      // Project-scoped (the assistant audit), mirroring the lineage/sessions
      // getters: scope to the injected pid, falling back to the first project
      // only for the pre-first-paint instant. The backend returns a flat list
      // ordered by (node_id, sequence, created_at); group it by node_id into the
      // shape the graph folds per node. Resolves `{}` for an audit-less project
      // (no throw); rejects only on a fetch/auth error (apiGet throws on non-2xx
      // → the catalog keeps its fixtures).
      const pid = await scopedProjectId();
      const entries = await apiGet<BackendAuditEntry[]>(
        `/api/projects/${encodeURIComponent(pid)}/audit`,
        deps.getToken(),
      );
      return toAuditByNode(entries);
    },

    async getAllChats(): Promise<ChatHistoryItem[]> {
      // The full first page of the scoped project's sessions, mapped. Resolves []
      // for a session-less project (no throw); rejects only on a fetch/auth error.
      const now = Date.now();
      const sessions = await fetchSessions();
      return sessions.map((s) => toChatHistoryItem(s, now));
    },

    async getRecents(): Promise<ChatHistoryItem[]> {
      // The five most-recent sessions (by last activity, then creation), mapped.
      // Shares the per-pid sessions fetch with getAllChats.
      const now = Date.now();
      const sessions = await fetchSessions();
      return [...sessions]
        .sort((a, b) => recencyOf(b) - recencyOf(a))
        .slice(0, 5)
        .map((s) => toChatHistoryItem(s, now));
    },

    async toggleAuditEntry(auditEntryId: string, enabled: boolean): Promise<void> {
      // The catalog's first WRITE: PATCH the project-scoped audit entry. The
      // backend resolves the transform via the reversed FK and flips its status
      // (recompiling the staging SQL on read). Project-scoped like the reads;
      // rejects on a non-2xx (apiPatch throws) so the catalog rolls back its
      // optimistic flip. The response body is ignored — the write-through
      // revalidates the affected scope from the read endpoints instead.
      const pid = await scopedProjectId();
      await apiPatch(
        `/api/projects/${encodeURIComponent(pid)}/audit/${encodeURIComponent(auditEntryId)}`,
        { enabled },
        deps.getToken(),
      );
    },
  };
}
