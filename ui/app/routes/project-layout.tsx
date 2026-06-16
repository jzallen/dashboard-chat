/* /project/:projectId — the thin project layout nested inside app-shell.

   Its server `loader` reads the project-scoped catalog endpoints through S1's
   `apiFetch` (the cookie→Bearer hop) so the scoped project's data is fetched
   server-side and serialized into the initial document payload, replacing the
   prior browser `clientLoader` kick. The component seeds the catalog from
   `useLoaderData()` and re-scopes the `scopedProjectId` holder so writes
   (`toggleAudit`/write-through revalidation) target the right pid.

   RRv7 re-fires the loader on every :projectId change — that's the re-scope seam
   `shouldRevalidate` keys on. The single catalog instance is preserved: the
   persistent chrome (Topbar) keeps its useSyncExternalStore subscriptions; only
   the snapshot's project-scoped payloads change. The body is just <Outlet/> — the
   nested resource routes render under the re-scoped graph. */
import { useEffect } from "react";
import {
  type LoaderFunctionArgs,
  Outlet,
  redirect,
  useLoaderData,
  useOutletContext,
  useRouteError,
} from "react-router";

import type {
  AuditEntry,
  ChatHistoryItem,
  DbtFile,
  Edge,
  LineageNode,
  SourceUpload,
} from "../catalog";
import {
  type BackendAuditEntry,
  toAuditByNode,
} from "../catalog/dataSources/auditMappers";
import {
  type BackendDbtManifest,
  toDbtFiles,
} from "../catalog/dataSources/dbtMappers";
import type {
  BackendDataset,
  BackendReport,
  BackendSource,
  BackendView,
} from "../catalog/dataSources/lineageMappers";
import { toLineageGraph } from "../catalog/dataSources/lineageMappers";
import {
  unwrapList,
  unwrapSingle,
} from "../catalog/dataSources/metadataMappers";
import type { BackendSession } from "../catalog/dataSources/sessionMappers";
import { toChatHistoryItem, toRecents } from "../catalog/dataSources/sessionMappers";
import { seedProjectScoped, selectProject } from "../components/useCatalog";
import {
  apiFetch,
  ApiUnauthenticatedError,
  assertAuthenticated,
} from "../lib/api-client";

/**
 * The project-scoped payload the server `loader` fetches and returns for the
 * initial document — the catalog data keyed to a single `/project/:projectId`.
 * The component seeds the catalog from it via `useLoaderData()`.
 *
 * `nodes`/`edges` are the lineage graph DERIVED from the project's sources,
 * datasets, views, and reports (`toLineageGraph`); `audit` is folded by node id;
 * `chats`/`recents` come from the project's sessions (recents = top-5 by
 * recency); `dbtFiles` from the project's dbt manifest.
 *
 * `sourceUploads` is per-source (keyed by source id, not just the project), so it
 * stays on a source-detail child loader rather than fanning this project loader
 * out across every source; the loader returns it empty and the field is carried
 * for shape parity only.
 */
export interface ProjectScopedData {
  projectId: string;
  nodes: Record<string, LineageNode>;
  edges: Edge[];
  audit: Record<string, AuditEntry[]>;
  dbtFiles: DbtFile[];
  chats: ChatHistoryItem[];
  recents: ChatHistoryItem[];
  sourceUploads: Record<string, SourceUpload[]>;
}

/**
 * Throw on a non-2xx read so a backend failure surfaces the route `ErrorBoundary`
 * rather than resolving a silent empty/partial catalog. A 401 is handled upstream
 * by {@link assertAuthenticated} (→ `/login` redirect); every other non-OK status
 * is a genuine read failure. An empty-but-OK list is NOT a failure — it resolves
 * normally (the emptiness contract).
 */
function assertReadOk(response: Response): Response {
  if (!response.ok) {
    throw new Error(`project-scoped read failed: ${response.status}`);
  }
  return response;
}

/**
 * Fetch the project-scoped catalog reads — sources, datasets, views, reports,
 * sessions, dbt manifest, and audit entries — server-side so the scoped project's
 * data is serialized into the initial document rather than fetched after
 * hydration. Each endpoint is reached through S1's `apiFetch` (the cookie→Bearer
 * hop), which returns the raw upstream Response — so each body is read, unwrapped
 * from its JSON:API envelope, and mapped to the catalog DTOs off the shared pure
 * mappers (so the loader and the browser `metadataApiSource` map identically).
 *
 * Source uploads are NOT fetched here: they are per-source (keyed by a source id,
 * not the project), so they stay on a source-detail child loader rather than
 * fanning this loader out across every source — `sourceUploads` is returned empty.
 *
 * A non-401 read failure throws (the route `ErrorBoundary` renders) rather than
 * resolving an empty/partial catalog; an unauthenticated (401) response becomes a
 * redirect to /login, mirroring the app-shell loader.
 */
export async function loader({
  request,
  params,
}: LoaderFunctionArgs): Promise<ProjectScopedData> {
  const projectId = params.projectId;
  if (!projectId) throw new Error("project-layout loader: missing projectId");
  const pid = encodeURIComponent(projectId);

  // Fire the project-scoped reads in parallel through S1's server `/api` hop. A
  // 401 on any of them is the unauthenticated signal (→ /login); any other non-OK
  // status surfaces the ErrorBoundary (no silent empty catalog). Source uploads
  // are NOT fetched here: they are per-source (keyed by source id, not the
  // project), so they stay on a source-detail child loader rather than fanning
  // the project loader out across every source.
  let responses: Response[];
  try {
    responses = await Promise.all(
      [
        `/sources?project_id=${pid}`,
        `/datasets?project_id=${pid}`,
        `/projects/${pid}/views`,
        `/projects/${pid}/reports`,
        `/projects/${pid}/sessions`,
        `/projects/${pid}/export/dbt/manifest`,
        `/projects/${pid}/audit`,
      ].map((path) =>
        apiFetch(request, path).then(assertAuthenticated).then(assertReadOk),
      ),
    );
  } catch (err) {
    if (err instanceof ApiUnauthenticatedError) throw redirect("/login");
    throw err;
  }
  const [sourcesRes, datasetsRes, viewsRes, reportsRes, sessionsRes, dbtRes, auditRes] =
    responses;

  // `apiFetch` returns the raw upstream Response, so unwrap each JSON:API envelope
  // here before mapping — the same unwrap the browser `apiGet` does, so the loader
  // and `metadataApiSource` map identically off the shared pure mappers.
  const sources = unwrapList<BackendSource>(await sourcesRes.json());
  const datasets = unwrapList<BackendDataset>(await datasetsRes.json());
  const views = unwrapList<BackendView>(await viewsRes.json());
  const reports = unwrapList<BackendReport>(await reportsRes.json());
  const sessions = unwrapList<BackendSession>(await sessionsRes.json());
  const manifest = unwrapSingle<BackendDbtManifest>(await dbtRes.json());
  const auditEntries = unwrapList<BackendAuditEntry>(await auditRes.json());

  const { nodes, edges } = toLineageGraph(sources, datasets, views, reports);
  const now = Date.now();
  return {
    projectId,
    nodes,
    edges,
    audit: toAuditByNode(auditEntries),
    dbtFiles: toDbtFiles(manifest),
    chats: sessions.map((session) => toChatHistoryItem(session, now)),
    recents: toRecents(sessions, now),
    sourceUploads: {},
  };
}

/**
 * Re-scope only when the path project changes. Without this, RRv7 revalidates the
 * loader on every navigation under the layout — including search-param-only
 * changes (e.g. the workspace's `?view=` toggle) and nested resource navigations
 * — needlessly re-running the project-scoped reads. The scope's only input is
 * projectId, so projectId-equality is the precise revalidation key; on a change
 * the loader re-runs for the new scope and the prior scope's data is not surfaced.
 */
export function shouldRevalidate({
  currentParams,
  nextParams,
}: {
  currentParams: { projectId?: string };
  nextParams: { projectId?: string };
}) {
  // TODO: this is a business rule about project-scope identity ("the scope changed
  // iff the project changed"), not routing glue. It belongs on a domain model or
  // projection (e.g. a scope-equality on ProjectSummary) that this route hook
  // delegates to, keeping the rule reusable and the route module thin.
  return currentParams.projectId !== nextParams.projectId;
}

/**
 * Surface a project-scoped backend read failure here instead of a silent empty
 * catalog — the loader throws on a non-401 read failure and RRv7 renders this
 * boundary in place of the route tree, so no empty catalog renders underneath.
 * Reads the thrown error via `useRouteError` and offers a retry that re-runs the
 * loader for the current scope (a full reload, since the failed payload never
 * reached the catalog).
 */
export function ErrorBoundary() {
  const error = useRouteError();
  const detail =
    error instanceof Error ? error.message : "The project failed to load.";
  return (
    <div role="alert" className="project-load-error">
      <h2>Couldn’t load this project</h2>
      <p>{detail}</p>
      <button type="button" onClick={() => window.location.reload()}>
        Retry
      </button>
    </div>
  );
}

export default function ProjectLayout() {
  // Forward app-shell's outlet context (onOpenNode) down to the nested resource
  // routes — without this, their useShellContext() would read THIS Outlet's
  // (empty) context instead of the chrome's.
  const ctx = useOutletContext();
  const data = useLoaderData() as ProjectScopedData | undefined;

  // Seed the SSR'd project-scoped payloads into the catalog snapshot and re-scope
  // the holder so writes (toggleAudit/write-through revalidation) target this pid.
  useEffect(() => {
    if (!data) return;
    void selectProject(data.projectId);
    seedProjectScoped(data);
  }, [data]);

  return <Outlet context={ctx} />;
}
