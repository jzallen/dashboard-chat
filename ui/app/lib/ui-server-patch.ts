/**
 * brokerPatch — the shared body of every `/ui-server/*` PATCH resource-route
 * action (dataset display-name / model_name, view rename, report rename, audit
 * toggle). Each route differs only in the backend `/api` path it targets, built
 * from its own params; the forwarding shape is identical, so it lives here once
 * rather than copied across four files.
 *
 * The browser submits to the resource route via `<Form>` / `useFetcher`
 * same-origin (riding its session cookie); this forwards the inbound PATCH method
 * + JSON body + user credential to the backend through auth-proxy via
 * {@link apiFetch}, which re-verifies the session and injects the identity headers
 * downstream. The inbound body is carried through unchanged (content-type
 * preserved).
 *
 * The upstream status + body are passed straight through. A non-2xx (e.g. a 409
 * model_name collision or a 401) is NOT turned into a `/login` redirect: this is a
 * fetcher target, not a navigation, so the caller surfaces the error and reverts
 * any opt-in optimistic UI. Pessimistic-by-default (ADR-034): RRv7 auto-revalidates
 * the active loaders only on a 2xx.
 */
import { apiFetch } from "./api-client";

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
