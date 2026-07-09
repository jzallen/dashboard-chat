// Composition root. `Layout` owns the document shell; `Root` mounts the app's
// provider tree around the routed <Outlet/>.
//
// `clientLoader` awaits initCatalog() before the route tree renders, so the live
// `catalog` binding (app/components/useCatalog.ts) is defined before any component
// reads it. The catalog seeds synchronously from the fixture fallback, so this
// resolves even with no auth token.

// Global stylesheets — theme first so the neobrutalist sheet can override it.
import "./components/theme.css";
import "./components/theme.neobrutalist.css";

import { type ReactNode } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

import { ThemeProvider } from "./components/AppShell";
import { FlashedNodeProvider } from "./components/FlashedNodeProvider";
import { CatalogProvider, initCatalog } from "./components/useCatalog";
import { SessionLifecycleProvider } from "./lib/SessionLifecycleProvider";
import { StateProxyProvider } from "./lib/StateProxyProvider";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <Meta />
        <Links />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800;900&family=Baloo+2:wght@400..800&family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Hanken+Grotesk:wght@400..700&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400..600&family=Space+Grotesk:wght@400..700&display=swap"
          rel="stylesheet"
        />
        <title>Dashboard Chat — Layers</title>
      </head>
      <body>
        <div id="root">{children}</div>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

// Compose the catalog before first render so `catalog` is defined for every
// component that reads it.
export async function clientLoader() {
  await initCatalog();
  return null;
}

// A one-time bootstrap — never re-run on navigation. Without this, RRv7 would
// revalidate this loader on every navigation (including `?view=` toggles), and
// re-running initCatalog would rebuild the catalog from the fixture seed without
// re-scoping it to the path project, surfacing fallback data.
export function shouldRevalidate() {
  return false;
}

// Render nothing while the catalog composes.
export function HydrateFallback() {
  return null;
}

export default function Root() {
  return (
    <ThemeProvider>
      <CatalogProvider>
        <FlashedNodeProvider>
          <StateProxyProvider>
            <SessionLifecycleProvider>
              <Outlet />
            </SessionLifecycleProvider>
          </StateProxyProvider>
        </FlashedNodeProvider>
      </CatalogProvider>
    </ThemeProvider>
  );
}
