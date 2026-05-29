// Framework-mode route — `/projects`.
//
// ADR-046 MR-4: the loader reads the `projectContext` REGION off the ONE `/state`
// document for the `most_recent_session_per_project` map (per OQ-J002-5 / DWD-9)
// so the projects list can server-side-render which project is the last-used one.
// The page component itself keeps the existing `ProjectsPage` UI from
// `src/ui/components/OrgView` for visual continuity; it can opt into
// `useLoaderData` in a future MR.
//
// Per DWD-4: the document is fetched via `fetchStateDocument` through the
// request-scoped auth header. The loader is bounded by the same 5s budget as the
// root loader (DD-16) — a 504 here surfaces to the route's ErrorBoundary rather
// than hanging SSR.

import type { LoaderFunctionArgs } from "react-router";

import { ProjectsPage } from "../../src/ui/components/OrgView";
import { fetchStateDocument } from "../lib/ui-state-client";

export interface ProjectsLoaderData {
  org_id: string;
  selected_project_id: string | null;
  selected_project_name: string | null;
  most_recent_session_per_project: Record<string, string>;
  last_used_resolution_degraded: {
    failed_project_ids: string[];
    partial_result: boolean;
  } | null;
}

export async function loader({
  request,
}: LoaderFunctionArgs): Promise<ProjectsLoaderData> {
  // ADR-046 MR-4: one GET /state; identity is header-derived (auth-proxy).
  try {
    const document = await fetchStateDocument(request);
    const ctx = document.regions.projectContext.context;
    return {
      org_id: document.active_scope.org_id,
      selected_project_id: ctx.project.id ?? null,
      selected_project_name: ctx.project.name ?? null,
      most_recent_session_per_project: ctx.most_recent_session_per_project ?? {},
      last_used_resolution_degraded: ctx.last_used_resolution_degraded ?? null,
    };
  } catch (err) {
    if (err instanceof Response && err.status === 504) throw err;
    return {
      org_id: "",
      selected_project_id: null,
      selected_project_name: null,
      most_recent_session_per_project: {},
      last_used_resolution_degraded: null,
    };
  }
}

export default ProjectsPage;
