// Framework-mode route — `/projects`.
//
// MR-1 sub-step 01-02: added a server-side `loader` that reads the J-002
// projection's `most_recent_session_per_project` map (per OQ-J002-5 / DWD-9)
// so the projects list can server-side-render which project is the
// last-used one. The page component itself keeps the existing
// `ProjectsPage` UI from `src/ui/components/OrgView` for visual continuity;
// it can opt into `useLoaderData` in a future MR.
//
// Per DWD-4: the J-002 projection is fetched via `uiStateClient` through
// the request-scoped auth header. The loader is bounded by the same 5s
// budget as the root loader (DD-16) — a 504 here surfaces to the route's
// ErrorBoundary rather than hanging SSR.

import type { LoaderFunctionArgs } from "react-router";

import { uiStateClient } from "../lib/ui-state-client";
import { ProjectsPage } from "../../src/ui/components/OrgView";

const DEFAULT_PRINCIPAL_ID = "dev-user-001";
const J002_MACHINE = "project-and-chat-session-management";

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
  const principalId = DEFAULT_PRINCIPAL_ID;
  const j002FlowId = `${J002_MACHINE}:${principalId}`;
  const client = uiStateClient(request);

  try {
    const j002 = await client.getJ002Projection(j002FlowId);
    const ctx = j002.context as {
      project?: { id: string | null; name: string | null };
      most_recent_session_per_project?: Record<string, string>;
      last_used_resolution_degraded?: {
        failed_project_ids: string[];
        partial_result: boolean;
      } | null;
    };
    return {
      org_id: j002.active_scope.org_id,
      selected_project_id: ctx.project?.id ?? null,
      selected_project_name: ctx.project?.name ?? null,
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
