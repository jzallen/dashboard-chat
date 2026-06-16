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
  useLoaderData,
  useOutletContext,
} from "react-router";

import type {
  AuditEntry,
  ChatHistoryItem,
  DbtFile,
  Edge,
  LineageNode,
  SourceUpload,
} from "../catalog";
import { seedProjectScoped, selectProject } from "../components/useCatalog";

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
 * `sourceUploads` is the one per-source read (keyed by source id, not just the
 * project) — DELIVER reconciles whether the project loader fans uploads out for
 * the project's sources or whether they stay on a source-detail child loader.
 * The skeleton only stubs the shape and notes the seam.
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
 * Fetch the project-scoped catalog reads — sources, datasets, views, reports,
 * sessions, dbt manifest, audit entries, and source uploads — server-side so the
 * scoped project's data is serialized into the initial document rather than
 * fetched after hydration. Each endpoint is reached through S1's `apiFetch`
 * (the cookie→Bearer hop), which returns the raw upstream Response — so each body
 * is read, unwrapped from its JSON:API envelope, and mapped to the catalog DTOs.
 *
 * A non-401 read failure throws (the route `ErrorBoundary` renders) rather than
 * resolving an empty/partial catalog; an unauthenticated (401) response becomes a
 * redirect to /login, mirroring the app-shell loader.
 */
export async function loader({
  request,
  params,
}: LoaderFunctionArgs): Promise<ProjectScopedData> {
  throw new Error(
    `project-layout loader not implemented (url=${request.url}, projectId=${params.projectId})`,
  );
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
 * boundary. DELIVER fleshes out the recovery surface.
 */
export function ErrorBoundary() {
  return <div role="alert">Failed to load this project.</div>;
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
