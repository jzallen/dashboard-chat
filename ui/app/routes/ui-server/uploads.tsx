// /ui-server/uploads — a resource route (action only, no component): the ui/
// server-side broker for the one-step dataset upload. The browser POSTs the
// multipart `{ file, project_id }` FormData same-origin (riding its session
// cookie); the action forwards the raw multipart body to the backend
// `POST /api/uploads` through auth-proxy via brokerUpload, which re-verifies the
// session and injects the identity headers downstream.
//
// The upstream status + JSON:API body (the created dataset) pass straight
// through; a non-2xx is NOT turned into a /login redirect (this is a fetch
// target, so the caller surfaces the failure). This retires the last
// browser-direct `/api` write — createDataset no longer calls `/api/uploads`.
import type { ActionFunctionArgs } from "react-router";

import { brokerUpload } from "../../lib/ui-server-client";

export async function action({ request }: ActionFunctionArgs): Promise<Response> {
  return brokerUpload(request, "/uploads");
}
