// /ui-server/projects/:projectId/reports/:reportId — a resource route (action
// only, no component): the ui/ server-side broker for a report rename. This is
// the home of an RRv7 `action`, not a transparent pass-through for a
// client-orchestrated catalog write (ADR-034): the browser submits here via
// `<Form>` / `useFetcher` same-origin (riding its session cookie), the action
// forwards the method + JSON body (`{ name }`) to the backend
// `/api/projects/{pid}/reports/{id}` through auth-proxy via apiFetch (which
// re-verifies the session and injects the identity headers downstream), and on
// success RRv7 auto-revalidates the active loaders so the catalog re-derives
// from server truth.
//
// The upstream status is passed straight through (a non-2xx is NOT turned into
// a /login redirect: this is a fetcher target, not a navigation).
// Pessimistic-by-default: a non-ok status surfaces an error to the caller and
// suppresses revalidation.
import type { ActionFunctionArgs } from "react-router";

export async function action({
  request,
  params,
}: ActionFunctionArgs): Promise<Response> {
  void request;
  void params;
  throw new Error("not implemented");
}
