// /ui-server/orgs/me — a resource route (loader only, no component): the ui/
// server-side broker for the onboarding driver's Phase-B org probe. The browser
// fetches same-origin (riding its session cookie); the loader forwards the GET +
// user credential to the backend `GET /api/orgs/me` through auth-proxy via
// brokerGet, which re-verifies the session and injects the identity headers
// downstream.
//
// The upstream status + body pass straight through; a non-2xx is NOT turned into
// a /login redirect (this is a fetch target, not a navigation). A definitive 404
// (`org_not_found`) and a 401 (the auth gate) must survive byte-intact so the
// onboarding client adapter can reconstruct ApiError(status, body) and the pure
// driver's status→cause matrix stays unchanged.
import type { LoaderFunctionArgs } from "react-router";

import { brokerGet } from "../../lib/ui-server-client";

export async function loader({ request }: LoaderFunctionArgs): Promise<Response> {
  return brokerGet(request, "/orgs/me");
}
