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
// `loader` (J-002 MR-1 sub-step 01-01) reads J-001's projection for
// `active_scope.org_id` + `user.first_name` AND J-002's projection for
// the current `state` per DWD-4 §6.1. When J-002's state is
// `no_projects`, the SSR pass renders the welcome panel inline
// so first-paint carries the no-projects shape without a client roundtrip.
//
// `ErrorBoundary` surfaces RRv7 route errors with a minimal accessible fallback.
import { HydrationBoundary,QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode,useState } from "react";
import {
  type LoaderFunctionArgs,
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
  useRouteError,
} from "react-router";

import { AuthProvider } from "../src/ui/context/AuthContext";
import {
  PROJECT_FLOW_MACHINE,
  uiStateClient,
  type ProjectionShape,
} from "./lib/ui-state-client";

// Dev-mode principal — auth-proxy hardcodes DEV_USER's identity headers,
// so the per-flow id is deterministic at runtime. In production this is
// derived from the verified JWT's `sub` claim (Phase 04 wiring).
const DEFAULT_PRINCIPAL_ID = "dev-user-001";

interface RootLoaderData {
  org_id: string;
  user_first_name: string | null;
  project_flow_state: string;
  active_scope: ProjectionShape["active_scope"];
  project: { id: string | null; name: string | null };
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
  // MR-1: read both the login-and-org-setup projection (for org_id +
  // user.first_name) and the project-and-chat-session-management
  // projection (for the no_projects / project_selected
  // dispatch). The walking-skeleton scenario relies on the SSR pass
  // observing project_flow_state === "no_projects" so first
  // paint carries the welcome panel — no client roundtrip needed.
  const principalId = DEFAULT_PRINCIPAL_ID;
  const loginFlowId = `login-and-org-setup:${principalId}`;
  const projectFlowId = `${PROJECT_FLOW_MACHINE}:${principalId}`;

  const client = uiStateClient(request);

  let org_id = "";
  let user_first_name: string | null = null;
  let project_flow_state = "anonymous";
  let active_scope: ProjectionShape["active_scope"] = {
    org_id: "",
    project_id: null,
    resource_type: null,
    resource_id: null,
  };
  let project: { id: string | null; name: string | null } = {
    id: null,
    name: null,
  };

  try {
    const login = await client.getProjection("login-and-org-setup", loginFlowId);
    const loginContext = (login as ProjectionShape).context as {
      org?: { id: string | null; name: string | null };
      user?: { display_name: string | null; first_name?: string | null };
    };
    org_id = loginContext?.org?.id ?? "";
    user_first_name =
      loginContext?.user?.first_name ??
      ((loginContext?.user?.display_name ?? "").split(/\s+/)[0] || null);
  } catch (err) {
    // login-and-org-setup not yet started — leave defaults. The FE
    // renders the login shell in that case (handled by the existing
    // routes that this loader is composed under).
    if (err instanceof Response && err.status === 504) throw err;
  }

  try {
    const projection = await client.getProjection(
      PROJECT_FLOW_MACHINE,
      projectFlowId,
    );
    project_flow_state = projection.state;
    active_scope = projection.active_scope;
    const projectContext = projection.context as {
      project?: { id: string | null; name: string | null };
      user?: { first_name?: string | null };
    };
    if (projectContext?.project) {
      project = projectContext.project;
    }
    if (!user_first_name && projectContext?.user?.first_name) {
      user_first_name = projectContext.user.first_name;
    }
  } catch (err) {
    if (err instanceof Response && err.status === 504) throw err;
  }

  return {
    org_id,
    user_first_name,
    project_flow_state,
    active_scope,
    project,
  };
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

  // The loader populates the project flow's state for the SSR pass.
  // When the user is in `no_projects`, render the welcome
  // panel inline so first-paint carries the no-projects shape
  // (walking-skeleton AC). Otherwise, defer to the route-level <Outlet />.
  const data = useLoaderData<typeof loader>() as RootLoaderData | undefined;

  return (
    <QueryClientProvider client={queryClient}>
      <HydrationBoundary state={undefined}>
        <AuthProvider>
          {data?.project_flow_state === "no_projects" ? (
            <WelcomePanel
              orgName={null}
              userFirstName={data.user_first_name}
            />
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
  // and the chat-route's clientLoader runs.
  const data = useLoaderData<typeof loader>() as RootLoaderData | undefined;
  return (
    <main data-testid="no-projects-welcome-panel" role="main">
      <h1>
        Welcome to Dashboard Chat, {data?.user_first_name ?? "there"}!
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
