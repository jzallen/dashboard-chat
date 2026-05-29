// Framework-mode route — `/projects/:projectId` AND
// `/projects/:projectId/datasets/:datasetId`.
//
// ADR-046 MR-4: the server-side `loader` drives a cold deep-link resolution
// before first paint. The loader:
//   1. Reads params.projectId (+ optional params.datasetId).
//   2. Calls `postStateEvent(request, { type: "open_deep_link", payload: {
//      intent_project_id, ... } })` — the deep-link is now an ordinary event on
//      the single `/state/events` write surface (the standalone /open-deep-link
//      route collapsed). The actor spawns implicitly on first contact and
//      re-resolves through resolving_initial_scope. (The payload uses the legacy
//      `intent_*` keys — their rename to `deeplink_*` is a deferred follow-up to
//      MR-D; the region reads below use the renamed `deeplink_project_id` field.)
//   3. Returns the settled `projectContext` region off the response document so
//      the SSR'd page body carries the resolved scope on first paint.
//
// Per ADR-029 §1 I4 + DWD-4: the resolver runs server-side at the HTTP edge; the
// document's top-level `active_scope` is authoritative on the rendered page.
// Cross-tenant / project-not-found land in scope_mismatch_terminal (the FE still
// gets a 200; the region's `state` carries the cause).

import type { LoaderFunctionArgs } from "react-router";

import { ProjectView } from "../../src/ui/components/DatasetView";
import { postStateEvent } from "../lib/ui-state-client";

export interface ProjectDetailLoaderData {
  org_id: string;
  project_id: string | null;
  project_name: string | null;
  state: string;
  underlying_cause_tag: string | null;
  /** URL-level project wish (deep-link half of audit §5 / MR-D). */
  deeplink_project_id: string | null;
  /** Resource fields stay on the `intent_resource_*` prefix — they're
   *  routed straight through the projection from the URL, never via a
   *  context field on either machine. Rename to `deeplink_resource_*`
   *  rides with the `open_deep_link` event-payload rename. */
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

  try {
    const payload: {
      intent_project_id: string;
      intent_resource_id?: string;
      intent_resource_type?: string;
    } = { intent_project_id: projectId };
    if (datasetId) {
      payload.intent_resource_id = datasetId;
      payload.intent_resource_type = "dataset";
    }
    const document = await postStateEvent(request, {
      type: "open_deep_link",
      payload,
    });
    const region = document.regions.projectContext;
    const ctx = region.context;
    return {
      org_id: document.active_scope.org_id ?? "",
      project_id: document.active_scope.project_id ?? ctx.project.id ?? null,
      project_name: ctx.project.name ?? null,
      state: region.state,
      underlying_cause_tag: ctx.underlying_cause_tag ?? null,
      deeplink_project_id: ctx.deeplink_project_id ?? projectId,
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
      deeplink_project_id: projectId,
      intent_resource_id: datasetId ?? null,
      intent_resource_type: datasetId ? "dataset" : null,
    };
  }
}

export default ProjectView;
