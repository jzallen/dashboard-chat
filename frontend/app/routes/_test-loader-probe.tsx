// Test-only probe route — frontend-coexistence Phase 04 / DD-16, DD-17, DD-18.
//
// Exercises the loader → fetchStateDocument → auth-proxy /ui-state/* path with a
// fresh per-request QueryClient (§6.4 horizontal-scale invariant; DWD-2 SSR
// pattern). Computes a SHA-256-derived fingerprint of the inbound
// `Authorization` header and embeds it in both dehydrated state and the
// rendered HTML so cross-bearer leak tests can verify the per-request
// identity boundary.
//
// Production gate: in AUTH_MODE=production the loader throws 404 so this
// surface never leaks into deployed environments. ErrorBoundary renders an
// HTML fallback with no stack-trace markers — timeouts surface as
// `Response(504)` (DD-16) and present as plain text only.
import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
} from "@tanstack/react-query";
import {
  isRouteErrorResponse,
  type LoaderFunctionArgs,
  useLoaderData,
  useRouteError,
} from "react-router";

import { fetchStateDocument } from "../lib/ui-state-client";

async function computeBearerFingerprint(authHeader: string): Promise<string> {
  if (!authHeader) return "anonymous";
  const data = new TextEncoder().encode(authHeader);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(0, 8);
}

export async function loader({ request }: LoaderFunctionArgs) {
  if ((process.env.AUTH_MODE ?? "dev") === "production") {
    throw new Response("not_found", { status: 404 });
  }
  // DWD-2: fresh QueryClient per request — never reach for a module-level
  // client. §6.4: this is the invariant that lets horizontal scale work.
  const client = new QueryClient();
  const bearer_fingerprint = await computeBearerFingerprint(
    request.headers.get("authorization") ?? "",
  );
  try {
    await client.prefetchQuery({
      queryKey: ["state-document"],
      queryFn: () => fetchStateDocument(request),
    });
  } catch (err) {
    // DD-16: a timeout surfaces as Response(504) from fetchStateDocument — let
    // it bubble so the ErrorBoundary renders the 504 fallback. Other errors are
    // swallowed so the probe still renders for the bearer-fingerprint check.
    if (err instanceof Response && err.status === 504) throw err;
  }
  return {
    dehydratedState: dehydrate(client),
    bearer_fingerprint,
    probe: "loader-probe-v1",
  };
}

export default function LoaderProbeRoute() {
  const { dehydratedState, bearer_fingerprint } =
    useLoaderData<typeof loader>();
  return (
    <HydrationBoundary state={dehydratedState}>
      <div data-testid="loader-probe">
        Loader probe — fingerprint {bearer_fingerprint}
      </div>
    </HydrationBoundary>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  if (isRouteErrorResponse(error)) {
    return (
      <div role="alert">
        Loader probe error: {error.status} — {error.statusText}
      </div>
    );
  }
  return <div role="alert">Loader probe unexpected error.</div>;
}
