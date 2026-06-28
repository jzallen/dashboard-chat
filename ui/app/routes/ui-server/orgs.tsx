// /ui-server/orgs — a resource route (action only, no component): the ui/
// server-side broker for the onboarding driver's org-create POST. The browser
// POSTs the `{ name }` body same-origin (riding its session cookie); the action
// forwards the method + JSON body to the backend `POST /api/orgs` through
// auth-proxy via brokerPost, which re-verifies the session and injects the
// identity headers downstream.
//
// The upstream status + body pass straight through; a non-2xx is NOT turned into
// a /login redirect (this is a fetch target, not a navigation). The definitive
// answers the driver maps must survive byte-intact: 201 → org_created, 409 →
// org_name_taken, 400/422 → org_name_invalid, 401 → the auth gate.
import type { ActionFunctionArgs } from "react-router";

import { brokerPost } from "../../lib/ui-server-client";

export async function action({ request }: ActionFunctionArgs): Promise<Response> {
  return brokerPost(request, "/orgs");
}
