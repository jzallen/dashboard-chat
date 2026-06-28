// /ui-server/projects — a resource route (loader + action, no component): the
// ui/ server-side broker for the onboarding driver's two project legs. The
// browser hits this route same-origin (riding its session cookie):
//
//   loader (GET)  → brokerGet  → backend `GET /api/projects`  — retry-probe /
//                   initial-scope resolution (non-empty → scope_resolved, empty
//                   200 → no_projects_found)
//   action (POST) → brokerPost → backend `POST /api/projects` — default-project
//                   create (201 → project_created)
//
// Both forward the inbound method + credential (and the JSON body for POST)
// through auth-proxy, which re-verifies the session and injects the identity
// headers downstream. The upstream status + body pass straight through; a non-2xx
// is NOT turned into a /login redirect (these are fetch targets, not
// navigations), so the driver can reconstruct ApiError(status, body) — a 401 is
// the auth gate.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { brokerGet, brokerPost } from "../../lib/ui-server-client";

export async function loader({ request }: LoaderFunctionArgs): Promise<Response> {
  return brokerGet(request, "/projects");
}

export async function action({ request }: ActionFunctionArgs): Promise<Response> {
  return brokerPost(request, "/projects");
}
