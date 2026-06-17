// /bff/datasets/:datasetId/restore — a resource route (action only, no
// component): the ui/ server-side broker for un-archiving a soft-deleted
// dataset. Mirror of the archive broker: the browser POSTs here same-origin
// (riding its session cookie); the action forwards to the backend
// `/api/datasets/{id}/restore` through auth-proxy via apiFetch, which
// re-verifies the session and injects the identity headers downstream.
//
// The upstream status is passed straight through (a non-2xx is NOT turned into
// a /login redirect: this is a fetch target, not a navigation, and the caller
// relies on the non-ok status to roll its optimistic change back).
import type { ActionFunctionArgs } from "react-router";

import { apiFetch } from "../lib/api-client";

export async function action({
  request,
  params,
}: ActionFunctionArgs): Promise<Response> {
  const datasetId = params.datasetId ?? "";
  const upstream = await apiFetch(
    request,
    `/datasets/${encodeURIComponent(datasetId)}/restore`,
    { method: "POST" },
  );

  // Pass the upstream status through unchanged. Carry the upstream body when
  // present (default to an empty JSON object so a body-less 2xx still parses for
  // a caller that reads JSON); never redirect on 401.
  const body = await upstream.text();
  const headers = new Headers();
  headers.set(
    "content-type",
    upstream.headers.get("content-type") ?? "application/json",
  );
  return new Response(body === "" ? "{}" : body, {
    status: upstream.status,
    headers,
  });
}
