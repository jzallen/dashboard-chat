// /ui-server/sources — a resource route (action only, no component): the ui/
// server-side broker for a source create, the first leg of the upload /
// source-creation saga. The browser POSTs the `{ project_id, name }` body
// same-origin (riding its session cookie); the action forwards the method +
// JSON body to the backend `POST /api/sources` through auth-proxy via apiFetch,
// which re-verifies the session and injects the identity headers downstream.
//
// The upstream status + body pass straight through; a non-2xx is NOT turned into
// a /login redirect (this is a fetch target, not a navigation — the saga relies
// on the status to report `source_upload_failed` and roll its optimistic node
// back). The presigned `PUT` to object storage stays a direct browser→storage
// call and never reaches here.
import type { ActionFunctionArgs } from "react-router";

export async function action(_args: ActionFunctionArgs): Promise<Response> {
  throw new Error("not implemented");
}
