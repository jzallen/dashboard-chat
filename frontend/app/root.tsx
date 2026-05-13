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
// `ErrorBoundary` surfaces RRv7 route errors with a minimal accessible fallback.
import { HydrationBoundary,QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode,useState } from "react";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
} from "react-router";

import { AuthProvider } from "../src/ui/context/AuthContext";

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

  return (
    <QueryClientProvider client={queryClient}>
      <HydrationBoundary state={undefined}>
        <AuthProvider>
          <Outlet />
        </AuthProvider>
      </HydrationBoundary>
    </QueryClientProvider>
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
