// Framework-mode route — `/projects/:projectId` AND
// `/projects/:projectId/datasets/:datasetId`.
//
// MR-1 sub-step 01-03 (US-204): added a server-side `loader` that drives
// a cold deep-link resolution through the project-and-chat-session-
// management flow before first paint. The loader:
//   1. Reads params.projectId (+ optional params.datasetId).
//   2. Calls `uiStateClient.openProjectDeepLink({ intent_project_id, ... })`
//      which POSTs to ui-state /open-deep-link. ui-state spawns the flow
//      if not yet started and forwards an `open_deep_link` event to the
//      actor.
//   3. Returns the settled projection's snapshot so the SSR'd page body
//      carries the resolved scope on first paint (no client roundtrip).
//
// Per ADR-029 §1 I4 + DWD-4: the resolver runs server-side at the HTTP
// edge; the projection's `active_scope` is authoritative on the rendered
// page. Cross-tenant / project-not-found land in scope_mismatch_terminal
// (the FE still gets a 200; the projection's `state` carries the cause).

import type { LoaderFunctionArgs } from "react-router";

import { uiStateClient } from "../lib/ui-state-client";
import { ProjectView } from "../../src/ui/components/DatasetView";

const DEFAULT_PRINCIPAL_ID = "dev-user-001";

export interface ProjectDetailLoaderData {
  org_id: string;
  project_id: string | null;
  project_name: string | null;
  state: string;
  underlying_cause_tag: string | null;
  intent_project_id: string | null;
  intent_resource_id: string | null;
  intent_resource_type: "dataset" | "view" | "report" | null;
}

export async function loader({
  params,
  request,
}: LoaderFunctionArgs): Promise<ProjectDetailLoaderData> {
  const projectId = params.projectId;
  const datasetId = params.datasetId; // optional — only present on the
  // /projects/:projectId/datasets/:datasetId route.

  if (!projectId) {
    throw new Response("missing projectId", { status: 400 });
  }

  const principalId = DEFAULT_PRINCIPAL_ID;
  const client = uiStateClient(request);

  try {
    const intent: {
      intent_project_id: string;
      intent_resource_id?: string;
      intent_resource_type?: "dataset" | "view" | "report";
    } = { intent_project_id: projectId };
    if (datasetId) {
      intent.intent_resource_id = datasetId;
      intent.intent_resource_type = "dataset";
    }
    const projection = await client.openProjectDeepLink(principalId, intent);
    const ctx = projection.context as {
      project?: { id: string | null; name: string | null };
      underlying_cause_tag?: string | null;
      intent_project_id?: string | null;
      intent_resource_id?: string | null;
      intent_resource_type?: "dataset" | "view" | "report" | null;
    };
    return {
      org_id: projection.active_scope.org_id ?? "",
      project_id: projection.active_scope.project_id ?? ctx.project?.id ?? null,
      project_name: ctx.project?.name ?? null,
      state: projection.state,
      underlying_cause_tag: ctx.underlying_cause_tag ?? null,
      intent_project_id: ctx.intent_project_id ?? projectId,
      intent_resource_id: ctx.intent_resource_id ?? datasetId ?? null,
      intent_resource_type: ctx.intent_resource_type ?? (datasetId ? "dataset" : null),
    };
  } catch (err) {
    if (err instanceof Response && err.status === 504) throw err;
    return {
      org_id: "",
      project_id: projectId,
      project_name: null,
      state: "anonymous",
      underlying_cause_tag: null,
      intent_project_id: projectId,
      intent_resource_id: datasetId ?? null,
      intent_resource_type: datasetId ? "dataset" : null,
    };
  }
}

export default ProjectView;
