// Framework-mode route module for /login (Phase 02 / MR-1).
//
// DWD-1: loader reads the bearer from `request.headers` via uiStateClient.
//        No useAuth/useContext inside the loader; no server-side AuthProvider.
// DWD-2: request-scoped QueryClient is dehydrated and shipped via loader
//        return; the component wraps its tree in <HydrationBoundary>.
// DD-11: getProjection requires `flow_id`; when absent the loader degrades
//        gracefully (skip prefetch, return empty dehydratedState).
// DD-8:  /login is MIGRATED_ROUTE_PATH — the first per-route migration.
import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
} from "@tanstack/react-query";
import {
  type LoaderFunctionArgs,
  isRouteErrorResponse,
  useLoaderData,
  useRouteError,
} from "react-router";

import { LoginPage } from "../../src/ui/components/LoginPage";
import { uiStateClient } from "../lib/ui-state-client";

export async function loader({ request }: LoaderFunctionArgs) {
  const client = new QueryClient();
  const flowId = new URL(request.url).searchParams.get("flow_id");
  if (flowId) {
    try {
      await client.prefetchQuery({
        queryKey: ["projection", "login-and-org-setup", flowId],
        queryFn: () =>
          uiStateClient(request).getProjection("login-and-org-setup", flowId),
      });
    } catch {
      // DD-11: graceful degradation — failed prefetch leaves cache empty.
    }
  }
  return {
    dehydratedState: dehydrate(client),
    active_scope: { kind: "anonymous" as const },
  };
}

export default function LoginRoute() {
  const { dehydratedState } = useLoaderData<typeof loader>();
  return (
    <HydrationBoundary state={dehydratedState}>
      <LoginPage />
    </HydrationBoundary>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  if (isRouteErrorResponse(error)) {
    return (
      <div role="alert">
        {error.status} — {error.statusText}
      </div>
    );
  }
  return <div role="alert">Unexpected error.</div>;
}
