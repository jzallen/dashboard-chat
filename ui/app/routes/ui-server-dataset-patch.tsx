// /ui-server/datasets/:datasetId — a resource route (action only, no
// component): the ui/ server-side broker for a dataset PATCH. It serves BOTH
// the display-name rename (`{ display_name }`) and the model_name change
// (`{ model_name }`) — the same backend endpoint, so the action is body-agnostic
// and forwards whatever JSON it is given.
//
// This is the home of an RRv7 `action`, not a transparent pass-through for a
// client-orchestrated catalog write (ADR-034): the browser submits here via
// `<Form>` / `useFetcher` same-origin (riding its session cookie), the action
// forwards the method + JSON body to the backend `/api/datasets/{id}` through
// auth-proxy via apiFetch (which re-verifies the session and injects the
// identity headers downstream), and on success RRv7 auto-revalidates the active
// loaders so the catalog re-derives from server truth. The inbound request body
// is carried through unchanged (content-type preserved).
//
// The upstream status is passed straight through (a non-2xx — e.g. a 409
// model_name collision or a 401 — is NOT turned into a /login redirect: this is
// a fetcher target, not a navigation). Pessimistic-by-default: a non-ok status
// surfaces an error to the caller and suppresses revalidation; an optimistic
// reflection is opt-in only where latency warrants it.
import type { ActionFunctionArgs } from "react-router";

export async function action({
  request,
  params,
}: ActionFunctionArgs): Promise<Response> {
  void request;
  void params;
  throw new Error("not implemented");
}
