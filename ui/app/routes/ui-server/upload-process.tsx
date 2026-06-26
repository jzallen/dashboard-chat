// /ui-server/sources/:sourceId/uploads/:uploadId/process — a resource route
// (action only, no component): the ui/ server-side broker for the process leg,
// the final step of the saga. The browser POSTs the (optional) `{ choices }`
// body same-origin (riding its session cookie); the action forwards the method +
// JSON body to the backend
// `POST /api/sources/{sourceId}/uploads/{uploadId}/process` through auth-proxy
// via apiFetch.
//
// A non-2xx — critically a 422 SchemaMismatch whose body carries the
// `{ missing, extra, type_mismatch }` detail — passes through UNCHANGED with its
// body byte-intact and NO /login redirect: the recovery UX parses that body to
// drive the schema-mismatch affordance.
import type { ActionFunctionArgs } from "react-router";

import { brokerPost } from "../../lib/ui-server-client";

export async function action({
  request,
  params,
}: ActionFunctionArgs): Promise<Response> {
  const sourceId = params.sourceId ?? "";
  const uploadId = params.uploadId ?? "";
  return brokerPost(
    request,
    `/sources/${encodeURIComponent(sourceId)}/uploads/${encodeURIComponent(uploadId)}/process`,
  );
}
