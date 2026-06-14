/**
 * metadataApiSource — a backend-backed {@link PartialCatalogSource} for project
 * reads plus the lineage core, scoped to the path project. It implements
 * `getProjects` (org-global), `getCurrentProject`, and the three lineage getters
 * (`getNodes`/`getEdges`/`getAudit`); every other catalog payload stays on the
 * fallback (the fixture today). It NEVER references the fallback.
 *
 * The backend has no lineage endpoint, so the graph is DERIVED client-side: the
 * SCOPED project's datasets, views, and reports are fetched once PER PROJECT
 * (memoized in a `Map<pid, Promise<…>>`) and mapped to nodes/edges by
 * {@link import("./lineageMappers")}. `getAudit` resolves `{}` (no backend
 * narrative).
 *
 * Scoping: the active project id is injected via `deps.getProjectId` (like
 * `deps.getToken`), so the catalog stays router-free. The scoped getters target
 * `deps.getProjectId() ?? firstPid` — the `?? firstPid` only covers the
 * pre-first-paint instant before the `/project/:projectId` layout loader runs
 * `selectProject`. `getCurrentProject` returns the project matching the scoped
 * pid (looked up in the fetched list), NOT `projects[0]`. `getProjects` stays
 * org-global (unaffected by the scope).
 *
 * Token decoupling: the auth token-getter is injected via `deps.getToken`, so
 * this module stays free of any `app/auth` import — `catalog` is pure.
 *
 * Failure vs. emptiness (the fallback contract): a fetch/auth ERROR rejects, so
 * {@link createDataCatalog} keeps the seeded fixtures (no crash). A LEGITIMATELY
 * EMPTY backend resolves normally — `getProjects` → `[]`, `getNodes` → `{}`,
 * `getEdges` → `[]` — so the graph rebuilds blank (correct onboarding state).
 * `getCurrentProject` is the one exception: `CurrentProject` is non-nullable, so
 * it still throws when there is no scoped (or first) project (an empty-shell
 * state is a separate follow-up).
 */
import type {
  AuditEntry,
  AuditTag,
  Edge,
  Layer,
  LineageNode,
  ModelKind,
} from "../lineage";
import type {
  ChatHistoryItem,
  CurrentProject,
  DbtFile,
  OrgMember,
  OrgSettings,
  ProjectSummary,
} from "../models";
import { apiGet, apiPatch, apiPost, apiUpload } from "./backendClient";
import type {
  BackendDataset,
  BackendReport,
  BackendSource,
  BackendView,
} from "./lineageMappers";
import { toLineageGraph } from "./lineageMappers";
import type { BackendSession } from "./sessionMappers";
import { toChatHistoryItem } from "./sessionMappers";
import type { PartialCatalogSource, SourceUpload } from "./source";

/**
 * An upload resource as the backend returns it (post envelope-unwrap):
 * snake_case attributes flattened alongside the resource `id`. Mapped to the
 * UI's {@link SourceUpload} by {@link toSourceUpload}.
 */
interface BackendUpload {
  id: string;
  upload_id: string;
  original_filename: string;
  file_size: number;
  status: string;
  row_count: number | null;
  created_at: string;
}

/**
 * Format an upload's `created_at` into a short relative/date string for the
 * Files list: "just now" (<1m), "Nm ago" (<1h), "Nh ago" (<24h), "Nd ago"
 * (<7d), else a "Mon D" date. Tolerates an unparseable timestamp → "".
 */
function formatUploadWhen(createdAt: string): string {
  // Normalize for cross-engine parsing + correct UTC interpretation: trim
  // sub-millisecond digits (Safari rejects 6-digit fractions → NaN → blank)
  // and mark a timezone-less timestamp as UTC (backend stores naive-UTC, so an
  // unmarked string would otherwise be parsed as local time and skew the age).
  let normalized = (createdAt ?? "").trim().replace(/(\.\d{3})\d+/, "$1");
  if (normalized && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized)) {
    normalized += "Z";
  }
  const then = Date.parse(normalized);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(then).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** Map a backend upload resource (snake_case) to the UI's {@link SourceUpload}. */
function toSourceUpload(upload: BackendUpload): SourceUpload {
  return {
    name: upload.original_filename,
    rows: upload.row_count ?? null,
    when: formatUploadWhen(upload.created_at),
    status: upload.status,
  };
}

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
   * Injected like {@link getToken} so the catalog stays router-free.
   */
  getProjectId?: () => string | undefined;
}

/**
 * Read the server-assigned id off a JSON:API single response `{ data: { id } }`.
 * Used by the write ports that go through `apiPost` — which returns the RAW
 * decoded body (it does NOT envelope-unwrap like `apiGet`), so the id is pulled
 * out here.
 */
function dataId(body: unknown): string {
  const data = (body as { data?: { id?: unknown } } | undefined)?.data;
  return String(data?.id);
}

/**
 * Map a backend project to the catalog's project-list DTO. `models` is 0 (not yet
 * backed by the API); `datasets` is the count of attached datasets.
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
        const [sources, datasets, views, reports] = await Promise.all([
          apiGet<BackendSource[]>(
            `/api/sources?project_id=${encodeURIComponent(pid)}`,
            tok,
          ),
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
        return toLineageGraph(sources, datasets, views, reports);
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

  // Drop the per-project memoized fetches so the next read re-fetches. Called
  // before a write-triggered revalidation (the only org-global memo, the project
  // list, is left intact — writes here don't change it).
  const invalidateScope = (pid: string): void => {
    lineageBundlesByPid.delete(pid);
    sessionsByPid.delete(pid);
  };

  // Drop the org-global memo (the project-list fetch) so the next getProjects
  // re-fetches. Called by refreshOrgGlobal before its re-reads — without this
  // the memo latches the first (possibly pre-onboarding, empty) list forever.
  const invalidateOrgGlobal = (): void => {
    projectsPromise = undefined;
  };

  return {
    invalidateScope,
    invalidateOrgGlobal,
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

    async renameModel(
      id: string,
      kind: ModelKind,
      name: string,
    ): Promise<void> {
      // A dataset's editable display label is `display_name` (its `name` is the
      // immutable upload filename); views and reports rename `name` directly.
      // Datasets are addressed org-globally; views/reports are project-scoped.
      // Rejects on a non-2xx (apiPatch throws) so the catalog rolls back.
      const token = deps.getToken();
      if (kind === "dataset") {
        await apiPatch(
          `/api/datasets/${encodeURIComponent(id)}`,
          { display_name: name },
          token,
        );
        return;
      }
      const pid = await scopedProjectId();
      const collection = kind === "view" ? "views" : "reports";
      await apiPatch(
        `/api/projects/${encodeURIComponent(pid)}/${collection}/${encodeURIComponent(id)}`,
        { name },
        token,
      );
    },

    async setModelName(id: string, modelName: string): Promise<void> {
      // A dataset's dbt machine name is `model_name` — DECOUPLED from the
      // `display_name` that `renameModel` edits. PATCH it on its own so a
      // machine-name change never disturbs the display label. The backend
      // normalizes (`stg_<snake>`), rejects collisions (409), and repoints the
      // live warehouse view. Rejects on a non-2xx (apiPatch throws) so the
      // caller surfaces the error (no optimistic flip to roll back).
      await apiPatch(
        `/api/datasets/${encodeURIComponent(id)}`,
        { model_name: modelName },
        deps.getToken(),
      );
    },

    async archiveModel(id: string, kind: ModelKind): Promise<void> {
      // Only datasets support a restorable soft-delete (archived_at + retention);
      // views/reports have hard-delete only, so archiving them is left local-only
      // (no backend op) rather than an irreversible delete. Rejects on a non-2xx
      // (apiPost throws) so the catalog restores the optimistically-hidden node.
      if (kind !== "dataset") return;
      await apiPost(
        `/api/datasets/${encodeURIComponent(id)}/archive`,
        undefined,
        deps.getToken(),
      );
    },

    async restoreModel(id: string, kind: ModelKind): Promise<void> {
      if (kind !== "dataset") return;
      await apiPost(
        `/api/datasets/${encodeURIComponent(id)}/restore`,
        undefined,
        deps.getToken(),
      );
    },

    async createDataset(file: File): Promise<{ id: string }> {
      // One-step multipart upload: the backend writes the raw file to the data
      // lake (minio), creates the dataset (parquet + schema inference), and
      // emits the upload outbox event — returning the created dataset. Rejects
      // on a non-2xx (apiUpload throws) so the caller can surface the failure.
      const pid = await scopedProjectId();
      const form = new FormData();
      form.append("file", file);
      form.append("project_id", pid);
      const res = await apiUpload<{ data: { id: string } }>(
        "/api/uploads",
        form,
        deps.getToken(),
      );
      return { id: res.data.id };
    },

    /* ─── Source-from-upload saga ports ──────────────────────────────────── */

    async getSources(): Promise<BackendSource[]> {
      // Project-scoped, mirroring the lineage getters. apiGet unwraps the
      // JSON:API list; resolves [] for a source-less project, rejects on a
      // fetch/auth error.
      const pid = await scopedProjectId();
      return apiGet<BackendSource[]>(
        `/api/sources?project_id=${encodeURIComponent(pid)}`,
        deps.getToken(),
      );
    },

    async getSourceUploads(sourceId: string): Promise<SourceUpload[]> {
      // GET /api/sources/{id}/uploads → JSON:API uploads list. apiGet unwraps
      // each resource to `{ id, ...attributes }`; map snake_case → the UI shape.
      // The source id IS the scope here (no project_id query needed). Rejects on
      // a fetch/auth error (apiGet throws on non-2xx).
      const uploads = await apiGet<BackendUpload[]>(
        `/api/sources/${encodeURIComponent(sourceId)}/uploads`,
        deps.getToken(),
      );
      return uploads.map(toSourceUpload);
    },

    async createSource(name: string): Promise<{ id: string }> {
      // POST /api/sources {project_id, name} → 201 JSON:API single. apiPost
      // returns the RAW body (no unwrap), so the id is read off `data.id`.
      // Rejects on a non-2xx (apiPost throws) so the saga reports failure.
      const pid = await scopedProjectId();
      const body = await apiPost<{ data: { id: string } }>(
        "/api/sources",
        { project_id: pid, name },
        deps.getToken(),
      );
      return { id: dataId(body) };
    },

    async requestUpload(
      sourceId: string,
      file: File,
    ): Promise<{ uploadId: string; putUrl: string; storageKey: string }> {
      // POST /api/sources/{id}/uploads {filename, content_type, size} → 202 RAW
      // (NOT JSON:API): {upload_id, put_url, storage_key, status}. The browser
      // uploads the bytes itself via putToStorage — no bytes are sent here.
      const body = await apiPost<{
        upload_id: string;
        put_url: string;
        storage_key: string;
        status: string;
      }>(
        `/api/sources/${encodeURIComponent(sourceId)}/uploads`,
        { filename: file.name, content_type: file.type, size: file.size },
        deps.getToken(),
      );
      return {
        uploadId: body.upload_id,
        putUrl: body.put_url,
        storageKey: body.storage_key,
      };
    },

    async putToStorage(putUrl: string, file: File): Promise<void> {
      // DIRECT browser → MinIO PUT. Plain fetch, NOT through the app/auth-proxy:
      // no session cookie, no Authorization header. The presign was signed with
      // a ContentType, so the PUT MUST echo `Content-Type: file.type` or MinIO
      // rejects the signature. Rejects on a non-2xx storage response.
      const response = await fetch(putUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!response.ok) {
        throw new Error(
          `PUT to storage failed with status ${response.status}`,
        );
      }
    },

    async processUpload(
      sourceId: string,
      uploadId: string,
      choices?: Record<string, unknown>,
    ): Promise<{ datasetId: string }> {
      // POST .../process → 200 JSON:API datasets (the linked/appended staging
      // Dataset). apiPost returns the RAW body, so the id is read off `data.id`.
      // A 4xx throws — notably a 422 SchemaMismatch (whose body carries the
      // missing/extra/type_mismatch columns) the saga reports as
      // source_upload_failed and the surface renders as a recovery affordance.
      const body = await apiPost<{ data: { id: string } }>(
        `/api/sources/${encodeURIComponent(sourceId)}/uploads/${encodeURIComponent(uploadId)}/process`,
        choices ? { choices } : undefined,
        deps.getToken(),
      );
      return { datasetId: dataId(body) };
    },
  };
}
