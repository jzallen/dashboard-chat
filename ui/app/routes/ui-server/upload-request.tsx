// /ui-server/sources/:sourceId/uploads — a resource route (no component) serving
// both legs of a source's uploads collection:
//
//   POST (action) — the ui/ server-side broker for the upload request +
//   presigned-URL mint, the second leg of the write saga. The browser POSTs the
//   `{ filename, content_type, size }` descriptor same-origin (riding its session
//   cookie); the action forwards the method + JSON body to the backend
//   `POST /api/sources/{sourceId}/uploads` through auth-proxy via apiFetch. The RAW
//   (non-JSON:API) 202 body — `{ upload_id, put_url, storage_key, status }` — passes
//   straight through with its status intact; the browser then PUTs the bytes
//   DIRECTLY to object storage with `put_url` — that presigned PUT never routes
//   through here. A non-2xx is NOT turned into a /login redirect.
//
//   GET (loader) — the read leg: the source's persisted upload history for the
//   upload modal's Files list, fetched server-side through the same `/api` hop and
//   mapped with toSourceUploads. The modal loads it via `useFetcher().load()` when
//   it opens for an existing source, so the browser only ever hits this same-origin
//   route, never the backend `/api` directly.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import type { SourceUpload } from "../../catalog";
import { unwrapList } from "../../catalog/dataSources/metadataMappers";
import {
  type BackendUpload,
  toSourceUploads,
} from "../../catalog/dataSources/uploadMappers";
import {
  apiFetch,
  ApiUnauthenticatedError,
  assertAuthenticated,
} from "../../lib/api-client";
import { brokerPost } from "../../lib/ui-server-client";

/** The loader payload: the source's persisted uploads, oldest-first. */
export interface SourceUploadsData {
  uploads: SourceUpload[];
}

/**
 * Read a source's persisted upload history server-side for the upload modal's
 * Files list. The read is fetched through the server `/api` hop (`apiFetch`, the
 * cookie→Bearer forward), then unwrapped from its JSON:API envelope and mapped by
 * the shared pure {@link toSourceUploads} so the loader and any future browser
 * source map identically.
 *
 * Graceful degradation — DELIBERATELY the OPPOSITE of the project loader: a 401 is
 * the unauthenticated signal and redirects to `/login` (mirroring the app-shell /
 * project loaders), but any OTHER read failure (a non-2xx upstream, or a thrown
 * fetch) is caught and resolves an EMPTY list rather than surfacing an
 * ErrorBoundary. The modal must still open and accept a fresh upload when the
 * history can't be read — the persisted history is additive, not load-bearing.
 */
export async function loader({
  request,
  params,
}: LoaderFunctionArgs): Promise<SourceUploadsData> {
  const sourceId = encodeURIComponent(params.sourceId ?? "");
  try {
    const response = assertAuthenticated(
      await apiFetch(request, `/sources/${sourceId}/uploads`),
    );
    if (!response.ok) return { uploads: [] };
    const uploads = unwrapList<BackendUpload>(await response.json());
    return { uploads: toSourceUploads(uploads) };
  } catch (err) {
    if (err instanceof ApiUnauthenticatedError) throw redirect("/login");
    return { uploads: [] };
  }
}

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
