/**
 * The shared brokers behind the `/ui-server/*` catalog-mutation resource routes —
 * the server-side hop a browser `<Form>` / `useFetcher` submission takes on its way
 * to the backend. Sibling of {@link apiFetch} (the auth-proxy `/api` hop it builds
 * on) and {@link agentFetch} (the `/worker` hop): the route-action plumbing lives
 * here once rather than copied across each resource route. Only {@link brokerPatch}
 * (PATCH) exists today; a broker for another verb would join it here.
 */
import { apiFetch } from "./api-client";

/**
 * Forward a `/ui-server/*` PATCH resource-route action to the backend `/api`
 * endpoint at `backendPath`. Every catalog-mutation route (dataset display-name /
 * model_name, view rename, report rename, audit toggle) differs only in that path,
 * built from its own params; the forwarding shape is identical.
 *
 * The browser submits same-origin (riding its session cookie); this forwards the
 * inbound PATCH method + JSON body + user credential to the backend through
 * auth-proxy via {@link apiFetch}, which re-verifies the session and injects the
 * identity headers downstream. The inbound body is carried through unchanged
 * (content-type preserved).
 *
 * The upstream status + body are passed straight through. A non-2xx (e.g. a 409
 * model_name collision or a 401) is NOT turned into a `/login` redirect: this is a
 * fetcher target, not a navigation, so the caller surfaces the error and reverts
 * any opt-in optimistic UI. Pessimistic-by-default (ADR-034): RRv7 auto-revalidates
 * the active loaders only on a 2xx.
 */
export async function brokerPatch(
  request: Request,
  backendPath: string,
): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "application/json";
  const upstream = await apiFetch(request, backendPath, {
    method: "PATCH",
    body: await request.text(),
    headers: { "content-type": contentType },
  });

  const headers = new Headers();
  headers.set(
    "content-type",
    upstream.headers.get("content-type") ?? "application/json",
  );
  // Default a body-less 2xx to an empty JSON object so a fetcher reading the
  // response as JSON still parses (mirrors the archive/restore brokers).
  const body = await upstream.text();
  return new Response(body === "" ? "{}" : body, {
    status: upstream.status,
    headers,
  });
}
