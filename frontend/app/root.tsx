// RRv7 framework-mode composition root — supersedes frontend/App.tsx (DWD-6).
//
// `Layout` owns the <html>/<head>/<body> shell so the SSR pass produces a full
// document RRv7 can hydrate via hydrateRoot(document, ...).
//
// `Root` (default export) mounts a request-scoped QueryClient via the
// useState lazy initializer (DWD-2 — TanStack Query SSR pattern: one client per
// request on the server, singleton on the client), <HydrationBoundary> for
// future loader-driven dehydration, then <AuthProvider> (DWD-1 — client-only,
// side effects fire in useEffect), then <Outlet />.
//
// `loader` (ADR-046 MR-4) fetches the ONE `/state` document once (the SSR seed)
// instead of reading two per-machine projections. `Root` seeds
// `createStateProxy({ seed })` from the loader's serialized document and reads
// region slices via `useSelector` (no machine runs client-side). The
// walking-skeleton first paint dispatches off `regions.projectContext.state ===
// "no_projects"` to render the welcome panel inline — the same dispatch the old
// loader did off `project_flow_state`, now off the document.
//
// `ErrorBoundary` surfaces RRv7 route errors with a minimal accessible fallback.
import {
  anonymousStateDocument,
  type ChatAppStateDocument,
} from "@dashboard-chat/ui-state-wire";
import { HydrationBoundary,QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSelector } from "@xstate/react";
import { type ReactNode,useState } from "react";
import {
  isRouteErrorResponse,
  Links,
  type LoaderFunctionArgs,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
  useRouteError,
} from "react-router";

import { AuthProvider } from "../src/ui/context/AuthContext";
import { createStateProxy } from "./lib/state-proxy";
import { fetchStateDocument } from "./lib/ui-state-client";

interface RootLoaderData {
  /** The SSR seed — the single `/state` document serialized into the hydration
   *  payload so `createStateProxy({ seed })` returns the real document on first
   *  render (no first-paint flash). */
  document: ChatAppStateDocument;
}

/** First-name selector reused by `Root` (reactive, via useSelector) and
 *  `HydrateFallback` (one-shot, off the seed). Reads the onboarding region first
 *  (where login carried it), falling back to its display_name, then to the
 *  project-context region — the same precedence the old two-projection loader used. */
function selectFirstName(d: ChatAppStateDocument): string | null {
  const onboarding = d.regions.onboarding.context.user;
  return (
    onboarding.first_name ??
    ((onboarding.display_name ?? "").split(/\s+/)[0] || null) ??
    d.regions.projectContext.context.user.first_name
  );
}

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <Meta />
        <Links />
        <title>Dashboard Chat</title>
      </head>
      <body>
        <div id="root">{children}</div>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export async function loader({
  request,
}: LoaderFunctionArgs): Promise<RootLoaderData> {
  // ADR-046 MR-4: ONE GET /state read replaces the two per-machine projection
  // reads. The document carries every region (onboarding + projectContext +
  // sessionChat) at once, so the welcome-panel dispatch and the user's name both
  // come from this single seed. Identity is header-derived (auth-proxy injects
  // X-User-Id from the forwarded Bearer); the loader sends only the Bearer.
  try {
    const document = await fetchStateDocument(request);
    return { document };
  } catch (err) {
    // A 504 surfaces to the ErrorBoundary (DD-16) rather than hanging SSR.
    if (err instanceof Response && err.status === 504) throw err;
    // No live/persisted actor (or a transient non-504) — fold to the anonymous
    // document so first paint still resolves a sensible phase + project region
    // (the walking-skeleton no-flow case renders the login shell via Outlet).
    return { document: anonymousStateDocument() };
  }
}

export default function Root() {
  // DWD-7: request-scoped QueryClient — this is now the sole client identity
  // after Phase 02 dropped the AppShell-internal <QueryProvider> wrap.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000,
            gcTime: 10 * 60 * 1000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  // ADR-046 MR-4: seed the StateProxy with the loader's document (no first-paint
  // flash) and read region slices via useSelector. The machine stays on the
  // server; the proxy is the client's stand-in. When the project region settles
  // in `no_projects`, render the welcome panel inline (walking-skeleton AC);
  // otherwise defer to the route-level <Outlet />.
  const data = useLoaderData<typeof loader>() as RootLoaderData | undefined;
  const [stateProxy] = useState(() =>
    createStateProxy({ seed: data?.document ?? anonymousStateDocument() }),
  );
  const projectState = useSelector(
    stateProxy,
    (d) => d.regions.projectContext.state,
  );
  const userFirstName = useSelector(stateProxy, selectFirstName);

  return (
    <QueryClientProvider client={queryClient}>
      <HydrationBoundary state={undefined}>
        <AuthProvider>
          {projectState === "no_projects" ? (
            <WelcomePanel orgName={null} userFirstName={userFirstName} />
          ) : (
            <Outlet />
          )}
        </AuthProvider>
      </HydrationBoundary>
    </QueryClientProvider>
  );
}

/**
 * No-projects welcome panel — rendered server-side when J-002 settles
 * in `no_projects` per US-201. The exact copy is asserted
 * by the walking-skeleton acceptance test on FIRST paint.
 */
function WelcomePanel({
  orgName,
  userFirstName,
}: {
  orgName: string | null;
  userFirstName: string | null;
}): ReactNode {
  const greetingName = userFirstName ?? "there";
  const orgPhrase = orgName ? `Welcome to ${orgName}` : `Welcome to Dashboard Chat`;
  return (
    <main data-testid="no-projects-welcome-panel" role="main">
      <h1>
        {orgPhrase}, {greetingName}!
      </h1>
      <p>Let&apos;s get started by creating your first project.</p>
    </main>
  );
}

/**
 * HydrateFallback — rendered server-side when a child route exports
 * clientLoader without a server loader (as `routes/chat.tsx` does for the
 * index path). Without this export, RRv7 renders a default empty fallback
 * that wipes out the parent Root component's children entirely. Here we
 * read the root loader's data and surface the welcome panel for the
 * no-projects state per US-201 — so first-paint carries the welcome shape
 * even when navigating into a clientLoader-only child.
 */
export function HydrateFallback() {
  // RRv7 invokes HydrateFallback during the SSR pass when any descendent
  // route exports `clientLoader`. The root loader's data IS available here
  // per RRv7 docs (root loader runs for every route).
  //
  // SSR-render the welcome panel here so first-paint carries the
  // no-projects shape for US-201. Post-hydration, the client takes over
  // and the chat-route's clientLoader runs. The name comes from the seed
  // document's onboarding region (ADR-046 MR-4).
  const data = useLoaderData<typeof loader>() as RootLoaderData | undefined;
  const userFirstName = data ? selectFirstName(data.document) : null;
  return (
    <main data-testid="no-projects-welcome-panel" role="main">
      <h1>
        Welcome to Dashboard Chat, {userFirstName ?? "there"}!
      </h1>
      <p>Let&apos;s get started by creating your first project.</p>
    </main>
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
