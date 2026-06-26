// /ui-server/sources/:sourceId/uploads — a resource route (action only, no
// component): the ui/ server-side broker for the upload request + presigned-URL
// mint, the second leg of the saga. The browser POSTs the
// `{ filename, content_type, size }` descriptor same-origin (riding its session
// cookie); the action forwards the method + JSON body to the backend
// `POST /api/sources/{sourceId}/uploads` through auth-proxy via apiFetch.
//
// The RAW (non-JSON:API) 202 body — `{ upload_id, put_url, storage_key, status }`
// — passes straight through with its status intact; the browser then PUTs the
// bytes DIRECTLY to object storage with `put_url` — that presigned PUT never
// routes through here. A non-2xx is NOT turned into a /login redirect.
import type { ActionFunctionArgs } from "react-router";

import { brokerPost } from "../../lib/ui-server-client";

export async function action({
  request,
  params,
}: ActionFunctionArgs): Promise<Response> {
  const sourceId = params.sourceId ?? "";
  return brokerPost(
    request,
    `/sources/${encodeURIComponent(sourceId)}/uploads`,
  );
}
