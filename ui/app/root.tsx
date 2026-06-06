// RRv7 framework-mode (SPA) composition root — Phase 0 walking skeleton
// (foamy-knitting-hennessy). Supersedes the old src/main.js → src/app/app.tsx
// mount() seam: `Layout` owns the document shell and `Root` mounts the prototype's
// provider tree around an <Outlet/>.
//
// `clientLoader` awaits initCatalog() before the route tree renders, replacing the
// old `await initCatalog(); mount()` ordering in main.js. RRv7 awaits clientLoader
// before rendering, so `catalog` (the live ESM binding in src/app/useCatalog.ts) is
// defined before any component reads it. createDataCatalog seeds synchronously from
// the fixtureSource fallback, so this resolves even with no auth token.
// Global stylesheets — imported here in the order main.js linked them (theme first
// so the neobrutalist sheet can override). The fonts/preconnect <link>s the old
// index.html carried are dropped for Phase 0 (not load-bearing for the gate).
import "../src/app/theme.css";
import "../src/app/theme.neobrutalist.css";

import { type ReactNode } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

import { ThemeProvider } from "../src/app/AppShell";
import { FlashedNodeProvider } from "../src/app/FlashedNodeProvider";
import { initCatalog } from "../src/app/useCatalog";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <Meta />
        <Links />
        {/* Google Fonts the prototype's index.html carried (reinstated from Phase 0). */}
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

// SPA: compose the catalog before first render so `catalog` is non-undefined for
// every component that reads it (useCatalog / LineageCanvas / Workspace).
export async function clientLoader() {
  await initCatalog();
  return null;
}

// Render nothing while the catalog composes (a beat on the fixture seed).
export function HydrateFallback() {
  return null;
}

export default function Root() {
  return (
    <ThemeProvider>
      <FlashedNodeProvider>
        <Outlet />
      </FlashedNodeProvider>
    </ThemeProvider>
  );
}
