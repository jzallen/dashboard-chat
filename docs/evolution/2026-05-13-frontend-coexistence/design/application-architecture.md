# Application Architecture — `frontend-coexistence`

> **Wave**: DESIGN (application scope)
> **Date**: 2026-05-13
> **Driving ADR**: [ADR-034](../../../decisions/adr-034-frontend-coexistence-via-rrv7-framework-mode.md) (Accepted 2026-05-12)
> **Inherits unchanged**: [ADR-031 §2 (nginx rules)](../../../decisions/adr-031-frontend-tier-transition-remix-alongside-nginx.md) · [ADR-031 §7 (auth path)](../../../decisions/adr-031-frontend-tier-transition-remix-alongside-nginx.md) · [ADR-015 (presentation-state routing)](../../../decisions/adr-015-headless-presentation-state-retrieval.md) · [ADR-029 (`active_scope`)](../../../decisions/adr-029-active-scope-propagation-contract.md)
> **Scope of this document**: application-level — how RRv7 framework-mode routes compose with the existing React SPA tree, how providers and contexts cross the SSR boundary, what the route module files look like, what the Hono SSR entry looks like, what MR-0 ships.

---

## 1. Scope statement

System-level decisions are settled by ADR-034:

- The migration substrate is **React Router v7 framework mode**. `react-router-dom@7.13.0` is already in `frontend/package.json`.
- A new **Hono container `web-ssr`** holds the SSR runtime; nginx (`reverse-proxy` compose service) continues to serve static assets and proxy the five existing rules byte-unchanged.
- The source tree stays at `frontend/`; ADR-033's source-tree/topology separation produces **one source body, two OCI images**.
- `ui-presentation/` dissolves into `frontend/app/routes/`.
- **MR-0 is no-behavior-change plumbing.** Subsequent MRs migrate routes one at a time.

This document covers only the application-level concerns the ADR deferred:

- Composition root shape (`main.tsx` → `root.tsx` transition).
- Provider tree across the SSR boundary (`AuthProvider`, `QueryClient`, `ScopeResolver`).
- Route module file shape (library-mode default, framework-mode opt-in).
- Hono SSR entry shape.
- Auth context, query cache, and active-scope contracts under SSR.
- SSE-bearing routes (chat) and the `clientLoader`-only opt-out.
- Error-boundary composition.
- MR-0 file-level specification.
- Reversibility at MR-0 and per-route level.

---

## 2. Reuse Analysis

Per the nw-design RPP F-1 fix, the table below enumerates every existing artifact in this domain that overlaps with what MR-0 might appear to need. The default for every overlap is **EXTEND** unless we have evidence that extending is impossible.

| Existing component | File | Overlap | Decision | Justification |
|---|---|---|---|---|
| `BrowserRouter` + `<Routes>` declaration | `frontend/App.tsx:33-53` | RRv7 framework mode supplies `RouterProvider` + route config; we could rewrite the routing layer. | **EXTEND** | RRv7 framework mode reuses the same `react-router-dom@7` package. The `<Routes>` element declaration is replaced *in MR-0* by a `routes.ts` config that **declares the same routes against the same components**. No re-architecture of the route surface. |
| `AuthProvider` (token state, login/logout, activity timer) | `frontend/src/ui/context/AuthContext/AuthProvider.tsx` | RRv7 loaders run server-side; they can't call `useContext`. Tempting to build a server twin. | **EXTEND (client-side preserved verbatim)** | `AuthProvider` owns browser-only state (sessionStorage, activity timer, inactivity modal). Loaders bypass it and read the Bearer token from `request.headers.get('Authorization')` (DWD-1). Server twin would duplicate state and create two truth sites. |
| `QueryProvider` + the shared `queryClient` | `frontend/src/ui/providers/QueryProvider.tsx` | Loaders that prefetch data need a `QueryClient`; tempting to construct a fresh one per loader. | **EXTEND via `dehydrate`/`HydrationBoundary`** | TanStack Query ships SSR primitives (DWD-2). The loader constructs a *request-scoped* `QueryClient`, prefetches, dehydrates, and returns the dehydrated state. The browser's existing `queryClient` (singleton mounted by `AppShell`) hydrates from it. No second client-side cache. |
| `useScope()` / `useRouteLoaderData("root")` | not yet implemented — ADR-029 §2 specifies the shape | ADR-029 already specifies the typed `useScope()` accessor for RRv7. | **CREATE as ADR-029 specifies** | The hook is a fresh implementation of an already-ratified contract — no existing implementation to extend. |
| `ui-state` BFF (`/ui-state/*` via auth-proxy) | `ui-state/index.ts` + `ui-state/lib/orchestrator.ts` | Loaders that need active-scope must read it from somewhere. | **EXTEND — loaders call `ui-state` over HTTP** | The BFF already exposes `GET /flow/:machine/projection` returning `FlowProjection` (which carries `active_scope`). Loaders compose with the existing BFF API; no parallel resolver. |
| `agent` (`/api/channels/:id/presentation-state` via direct nginx rule, ADR-015) | `agent/index.ts` | Routes that include the chat SSE stream cannot SSR meaningfully. | **EXTEND — no change** | The nginx rule is load-bearing per ADR-015. Chat-bearing routes opt out of SSR via `clientLoader` only (DWD-3). The agent and its endpoint are untouched. |
| Hono + `@hono/node-server` runtime | `agent/index.ts`, `ui-state/index.ts`, `auth-proxy/Dockerfile` | The SSR runtime needs a Node server. Tempting to introduce a new framework. | **EXTEND — Hono** | ADR-034 ratifies Hono as the SSR container's runtime (matches `agent/` and `ui-state/`). Mechanically identical bootstrap: `serve({ fetch: app.fetch, port })`. |
| Bazel `oci_image` pattern producing `dashboard-chat/<service>:bazel` images | `agent/BUILD.bazel:84-104`, `frontend/BUILD.bazel:355-376` | The new `web-ssr` image must build through the same mechanism. | **EXTEND — second `oci_image` target in `frontend/BUILD.bazel`** | ADR-034 §"Build pipeline" specifies a second `image_tar` target in the same BUILD file. Mirrors `agent/BUILD.bazel`'s esbuild → `node_20_slim` base. See §11 below for the build-pipeline reconciliation (ADR-034 says "ssr.Dockerfile"; this codebase builds frontend images via Bazel, not Dockerfiles — DWD-5 reconciles). |

**Zero CREATE-NEW decisions** outside what an already-ratified ADR (ADR-029 `useScope()`) prescribes. Every other application-level component extends or coexists with existing code.

---

## 3. Composition root shape

### 3.1 Today (SPA-only)

```
frontend/index.html       — <div id="root"></div> + <script src="/main.tsx">
frontend/main.tsx         — ReactDOM.createRoot(...).render(<StrictMode><BrowserRouter><App/></BrowserRouter></StrictMode>)
frontend/App.tsx          — <AuthProvider><Routes>…</Routes></AuthProvider>
frontend/src/ui/providers/QueryProvider.tsx  — mounted inside AppShell (frontend/src/ui/components/AppShell/index.tsx:55-59)
```

### 3.2 MR-0 (RRv7 framework mode, every route library-mode)

```
frontend/index.html       — UNCHANGED. Still references /main.tsx as the client entry.
frontend/main.tsx         — UNCHANGED in shape. Continues to hydrate against the routes config under React Router 7.
                            (Library-mode in framework-mode means main.tsx imports the same routes; the difference is the
                            build/server entry can also import them for SSR.)
frontend/App.tsx          — REMAINS (deprecated but not deleted; see §3.5).
frontend/app/root.tsx     — NEW. The RRv7 SSR-aware root. Owns <html>/<head>/<body> shell + top-level providers
                            + global ErrorBoundary.
frontend/app/routes.ts    — NEW. Declares the existing route surface against the same components in App.tsx.
                            Every route declared with empty `module: () => ({ default: ChatView })` style (library-mode
                            pass-through) — no `loader` exports anywhere.
frontend/app/routes/      — NEW directory. Empty at MR-0 except for the four files migrated from ui-presentation/ as
                            component-only modules (no loader exports — they remain pure components under
                            library-mode declarations).
frontend/ssr.ts           — NEW. Hono entry; mounts the RRv7 request handler. Reads PORT, AUTH_PROXY_URL.
```

### 3.3 `root.tsx` shape

`root.tsx` is the SSR-aware root module. Per RRv7 framework mode, it owns the entire HTML document — not just the React tree. The shell that lives in `index.html` today migrates into `root.tsx`'s `<Layout>` export.

```tsx
// frontend/app/root.tsx — MR-0 shape (illustrative; DELIVER produces the actual code).
import { Outlet, Scripts, ScrollRestoration, Meta, Links, isRouteErrorResponse, useRouteError } from "react-router";
import { QueryClient, QueryClientProvider, HydrationBoundary } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";

import { AuthProvider } from "@/auth/AuthProvider"; // re-exported from frontend/src/ui/context/AuthContext

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
  // One QueryClient per request on the server, but a single browser-side
  // client survives navigations (useState lazy initializer is the canonical
  // TanStack Query pattern for SSR).
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 5 * 60 * 1000 /* mirrors QueryProvider */ } },
  }));

  // dehydratedState is supplied by any loader that prefetches; root receives
  // it via useLoaderData when present.
  return (
    <QueryClientProvider client={queryClient}>
      <HydrationBoundary state={undefined /* root has no loader at MR-0 */}>
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
    return <div role="alert">{error.status} — {error.statusText}</div>;
  }
  return <div role="alert">Unexpected error.</div>;
}
```

**Key invariants at MR-0:**

1. **`AuthProvider` is mounted at the root** — same provider tree the SPA has today. Its internal state machine (`useTokenState`, `useInactivity`) runs purely client-side (sessionStorage, intervals, modals). On SSR, `AuthProvider`'s effects do not fire, but its render output (the React tree wrapping `<Outlet />`) is server-renderable because it does no DOM access in render.
2. **`QueryClientProvider` is mounted at the root** — replaces the *current* `AppShell`-scoped `<QueryProvider>` mount. (See §3.5 below — `AppShell` keeps its `QueryProvider` wrap at MR-0 to avoid duplicate-provider warnings until the per-route migration drops the inner wrap.)
3. **`HydrationBoundary state={undefined}` at MR-0** — root has no loader yet, so no dehydrated state to hydrate from. Per-route migrations add loaders that prefetch + dehydrate; their route component wraps its tree in `<HydrationBoundary state={loaderData.dehydratedState}>` to hand the prefetched cache to the browser's `queryClient`.
4. **`ErrorBoundary` export** is the root-level error boundary RRv7 surfaces when a loader throws or a render fails. The shell `<html>`/`<head>`/`<body>` is owned by `<Layout>` which RRv7 wraps around both the default and the error rendering — so error rendering still produces a valid HTML document.

### 3.4 `routes.ts` shape

`routes.ts` is RRv7 framework mode's route config. At MR-0 every existing route is declared **library-mode**: it points at the same component as `App.tsx` does today, with **no `loader` export**. This is the no-behavior-change posture ADR-034 §"Migration sequence" specifies.

```ts
// frontend/app/routes.ts — MR-0 shape (illustrative).
import type { RouteConfig } from "@react-router/dev/routes";
import { index, route, layout } from "@react-router/dev/routes";

export default [
  route("/login", "src/ui/components/LoginPage/index.tsx"),
  route("/logout", "src/ui/components/LogoutPage/index.tsx"),
  route("/auth/callback", "src/ui/components/AuthCallback/index.tsx"),
  route("/org/create", "src/ui/components/CreateOrg/index.tsx"),
  layout("src/ui/components/AppShell/index.tsx", [
    index("src/ui/components/ChatView/index.tsx"),
    route("chat/:channelId", "src/ui/components/ChatView/index.tsx"),
    route("projects", "src/ui/components/OrgView/index.tsx"),
    route("projects/:projectId", "src/ui/components/DatasetView/index.tsx"),
    route("projects/:projectId/datasets/:datasetId", "src/ui/components/DatasetView/index.tsx"),
    route("table/:datasetId", "src/ui/components/TableView/index.tsx"),
    route("view/:viewId", "src/ui/components/ViewDetailView/index.tsx"),
    route("report/:reportId", "src/ui/components/ReportDetailView/index.tsx"),
    route("query-engines", "src/ui/components/QueryEngineList/index.tsx"),
    route("query-engines/:nodeId", "src/ui/components/QueryEngineDetail/index.tsx"),
    route("sessions", "src/ui/components/SessionList/index.tsx"),
  ]),
] satisfies RouteConfig;
```

**Key invariants at MR-0:**

1. Each route file is a **plain React component**. No `loader` export. No `clientLoader` export. No `ErrorBoundary` export. RRv7 treats these as library-mode routes inside framework mode and renders them client-side after hydration.
2. The `<AppShell>` layout route preserves the `RequireAuth`/`RequireOrg` guarding behavior. `App.tsx`'s nested `<Route element={<RequireAuth><RequireOrg><AppShell/></...>>>...</Route>` collapses to `layout("...AppShell/index.tsx", [...])` — but the auth/org guards still need to fire. **At MR-0** the guards stay inside `<AppShell>` itself (which today already wraps its children in `<QueryProvider>` and reads `useAuth()`); MR-0 does not refactor them. A later MR can extract them to a layout-route loader once auth-related flows are SSR'd.
3. The `path` strings match the strings in `App.tsx` byte-identically. Header-of-screen URLs do not change.

### 3.5 What happens to `App.tsx` and `main.tsx`?

| File | MR-0 | After all routes migrated (future) |
|---|---|---|
| `frontend/index.html` | Unchanged. `<script type="module" src="/main.tsx">`. | RRv7's HTML emitter from `root.tsx` replaces it. `index.html` may be deleted in the final cleanup MR. |
| `frontend/main.tsx` | **Rewritten.** Reduces to the RRv7 framework-mode hydration entry: `hydrateRoot(document, <StrictMode><HydratedRouter /></StrictMode>)` (imports `HydratedRouter` from `react-router/dom`). The dev plugin would auto-generate an equivalent entry, but we keep an explicit minimal `main.tsx` so the client entry is visible in the source tree. | Removed once `root.tsx` is the sole client entry. |
| `frontend/App.tsx` | **Deleted at MR-0.** Its three responsibilities redistribute: `<AuthProvider>` moves to `root.tsx`; the `<Routes>` JSX collapses into `routes.ts`; the `RequireAuth` / `RequireOrg` helpers move into `frontend/src/ui/components/AppShell/index.tsx` (or a colocated `guards.tsx`). `<BrowserRouter>` does not survive — RRv7 framework mode supplies its own client router via `<HydratedRouter />`. | (Already gone at MR-0.) |

**The honest answer:** under MR-0 there is no `App.tsx` and no `<BrowserRouter>`. RRv7 owns the router lifecycle. The provider chain that was in `App.tsx → AppRoutes → AppShell` moves to `root.tsx → Outlet → routes from routes.ts → AppShell layout`.

`main.tsx`'s job collapses to the RRv7-prescribed `hydrateRoot(<HydratedRouter />)` entry. (The exact API is `<HydratedRouter />` from `react-router/dom` — RRv7's framework-mode hydration component.) The dev plugin auto-generates this if not present, but pinning an explicit `main.tsx` keeps the entry visible in the source tree.

---

## 4. Provider tree under SSR

### 4.1 `AuthProvider` — client-only, by construction

`AuthProvider` (`frontend/src/ui/context/AuthContext/AuthProvider.tsx`) does three things:

1. Holds token state via `useTokenState` (reads/writes `sessionStorage` and `localStorage`).
2. Schedules the inactivity timer via `useInactivity` (sets `setInterval`, listens on DOM events).
3. Renders an `<ActivityCheckModal>` floating UI element.

All three are browser-only. Under SSR, the rendered output is a React tree where `state.user`, `state.token`, etc. are all `null`/`false` because the initial `useTokenState` reads `sessionStorage` — which doesn't exist server-side. The provider must **be safe to render server-side** (no `window` access in render, no `localStorage` reads outside `useEffect`).

**The audit:** `useTokenState` and `useInactivity` are hooks; their `useEffect`s do the browser work. Render-time code paths read state (which initializes to `null`/`false`) and call `useCallback`/`useContext`. **Render is server-safe.**

**Loaders do not call `useAuth()`** — they can't (loaders run server-side, no React context exists). Per **DWD-1**, loaders read the Bearer token from `request.headers.get('Authorization')` and pass it through to auth-proxy. The token is forwarded into the request by the browser (the browser is the source of truth for auth state, per ADR-031 §7).

```ts
// Pattern any loader follows when it needs to call a downstream service.
// frontend/app/lib/ui-state-client.ts (NEW — illustrative)
export function uiStateClient(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  return {
    async getProjection(machine: string, flowId?: string) {
      const url = new URL(`/ui-state/flow/${machine}/projection`, "http://auth-proxy:3000");
      if (flowId) url.searchParams.set("flow_id", flowId);
      const res = await fetch(url, { headers: { authorization: authHeader } });
      if (!res.ok) throw new Response(`ui-state ${res.status}`, { status: res.status });
      return res.json();
    },
  };
}
```

This client mirrors the pattern ADR-029 §2 establishes and ADR-031 §7 ratifies. **No server-side `AuthProvider`. No duplicate auth state.**

### 4.2 `QueryClient` — singleton on the client, request-scoped on the server

The current `frontend/src/ui/providers/QueryProvider.tsx` exports `queryClient = new QueryClient(...)` at module scope. Under SSR that's a **bug**: every server request would share the same client and could leak data across users.

**Per DWD-2**, the SSR-aware `root.tsx` constructs a `QueryClient` lazily via `useState(() => new QueryClient(...))`. This produces:

- **Server**: one `QueryClient` per request (React rebuilds the tree fresh; `useState` initializer runs once per SSR pass).
- **Client**: one `QueryClient` for the browser session (React re-uses the `useState` value across renders).

Loaders that prefetch data follow this shape:

```ts
// Per-route loader example (illustrative — not MR-0; lands in a future migration MR).
import { dehydrate, QueryClient } from "@tanstack/react-query";
import { uiStateClient } from "~/lib/ui-state-client";
import { projectionKey } from "~/lib/query-keys";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const client = new QueryClient(); // request-scoped
  await client.prefetchQuery({
    queryKey: projectionKey("login-and-org-setup", params.flowId!),
    queryFn: () => uiStateClient(request).getProjection("login-and-org-setup", params.flowId),
  });
  return { dehydratedState: dehydrate(client) };
}

export default function RouteComponent() {
  const { dehydratedState } = useLoaderData<typeof loader>();
  return (
    <HydrationBoundary state={dehydratedState}>
      <ProjectionView />
    </HydrationBoundary>
  );
}
```

The browser's root `<QueryClientProvider>` receives the dehydrated state via the per-route `<HydrationBoundary>` and merges it into its cache. The component renders synchronously with seeded data on first paint. **No double-fetch.**

### 4.3 Active-scope (ADR-029) integration

ADR-029 §2 specifies the propagation contract for "Option D (Remix)" — which is **RRv7 framework mode** under ADR-034. The contract is unchanged: the `active_scope` value lives in the root loader's return; `useScope()` reads it via `useRouteLoaderData("root")`.

At **MR-0**, no route has a loader, so no `active_scope` is propagated. The application continues to read scope from `useAuth()` / `useParams()` — the legacy paths that ADR-029 intends to retire.

**The migration sequence** (per ADR-029 §"Option D" + ADR-034 §"Migration sequence"):

1. **MR-0** (this feature): plumb framework mode; library-mode-as-default.
2. **MR-N (first auth-bearing migration)**: `root.tsx` gains a `loader` that calls `uiStateClient(request).getProjection("login-and-org-setup")` and returns `{ active_scope, user, dehydratedState }`. `useScope()` becomes live.
3. **MR-N+1..** (per-route): downstream routes add their own loaders that augment the scope with route-param-derived intent and call `ui-state` with `?flow_id=…`.

**Loaders that need active-scope read it from `ui-state` over HTTP** — not via a server-side reconstruction of `useSessionContext`. The reasoning is identical to DWD-1: the BFF already owns the resolution (per ADR-029 §"Decision outcome §1" the ScopeResolver lives in `ui-state/lib/active-scope.ts`); loaders are clients of that authority, not duplicators.

```
browser
  ↓ Authorization: Bearer …
reverse-proxy (nginx)         — proxies / to web-ssr
  ↓ Authorization: Bearer …
web-ssr (Hono + RRv7 SSR)
  ↓ root.tsx loader runs
  ↓ Authorization: Bearer …
auth-proxy
  ↓ /ui-state/flow/…/projection
ui-state (Hono + XState)
  ↓ resolves active_scope per ADR-029
ui-state ─→ auth-proxy ─→ web-ssr ─→ HTML emitted with active_scope dehydrated into the client-readable state
                                     <html><head/><body>…<HydrationBoundary state={{active_scope}}>…</body></html>
```

---

## 5. Hono SSR entry shape

`frontend/ssr.ts` is the new Hono entry that the `web-ssr` container's process runs. It is structurally identical to `agent/index.ts` and `ui-state/index.ts` — same Hono + `@hono/node-server` pattern, same env-var bootstrap.

```ts
// frontend/ssr.ts — MR-0 shape (illustrative).
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createRequestHandler } from "@react-router/node";
import * as build from "./build/server/index.js"; // produced by `vite build --ssr`

const PORT = parseInt(process.env.PORT ?? "3001", 10);
const NODE_ENV = process.env.NODE_ENV ?? "production";

const app = new Hono();

const reactRouterHandler = createRequestHandler({
  build,
  mode: NODE_ENV,
  getLoadContext: (request) => ({
    // Surface the incoming request headers to loaders. Identity is on
    // request.headers.get("Authorization"); loaders do NOT re-resolve.
  }),
});

// Liveness — matches the agent's /health convention so compose can wait on it.
app.get("/health", (c) => c.json({ status: "ok" }));

// Everything else is the RRv7 handler. Hono's c.req.raw is a Web standard
// Request; createRequestHandler accepts it directly.
app.all("*", async (c) => {
  return reactRouterHandler(c.req.raw, /* loadContext */ {});
});

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(JSON.stringify({ event: "web-ssr.startup", port: info.port, node_env: NODE_ENV }));
});

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
```

**Key invariants:**

1. **Hono does not serve static assets.** Per ADR-034 §"Topology" and the unchanged nginx config (§"What stays in nginx"), all `/assets/*` traffic is served from `reverse-proxy`'s `dist/client/` mount. The SSR container ships **only** the SSR bundle and serves only HTML responses (and the SSR-emitted asset URLs, which point back at nginx's static path).
2. **No `proxy_pass` rewrites in Hono.** All `/api/*`, `/worker/*`, `/health`, `/api/channels/:id/presentation-state` traffic is settled at nginx upstream of Hono. Hono only sees the routes nginx routes to it (everything that doesn't match the existing five rules).
3. **`createRequestHandler` from `@react-router/node`** is the framework-mode SSR adapter that mirrors the Remix v2 `createRequestHandler` shape. It accepts a Web `Request`; Hono's `c.req.raw` is exactly that type.
4. **The `build` import** is `./build/server/index.js` (or whatever the RRv7 Vite plugin emits — the project may pin `dist/server/` via `vite.config.ts`'s `build.outDir`). Vite's SSR build produces the server bundle when invoked with `vite build --ssr`. ADR-034 §"Build pipeline" specifies `dist/client/` + `dist/server/`; MR-0 explicitly configures `build.outDir` to honor this naming.

### 5.1 nginx upstream rule (system-level — already in ADR-034)

ADR-034 §"Topology" specifies one new nginx rule routing non-static, non-API requests to `http://web-ssr:3001`. The five existing rules (`/api/`, `/worker/`, `/api/channels/:id/presentation-state`, `/health`, `/assets/`) stay byte-unchanged. **MR-0 does not modify the rule ordering** beyond inserting the new catch-all that routes to `web-ssr` — the existing prefix-match-precedence behavior is preserved.

System-level concern. **Not in this DESIGN's scope**; flagged here for the DELIVER wave.

---

## 6. Build pipeline reconciliation

### 6.1 What ADR-034 says and what the codebase actually has

ADR-034 §"What's in the source tree" lists:

```
├── Dockerfile             (existing nginx-based; unchanged)
├── ssr.Dockerfile         (NEW — Hono + RRv7 SSR runtime; imports dist/server/)
```

`frontend/` today contains **no `Dockerfile`**. The existing nginx image is built end-to-end in `frontend/BUILD.bazel` via Bazel `oci_image` (`@nginx_alpine` base + four tar layers: `nginx_conf`, `assets`, `version`, `entrypoint`).

ADR-034's "Dockerfile" wording is shorthand for "build recipe for the image." The actual recipe in this codebase lives in `BUILD.bazel`.

### 6.2 DWD-5: SSR image follows the Bazel `oci_image` pattern

The SSR image should be built the same way the existing nginx image and the `agent/` image are — via Bazel `oci_image` with a `node_20_slim` base, producing `dashboard-chat/web-ssr:bazel`. This mirrors `agent/BUILD.bazel:84-104` byte-for-byte in structure:

```
frontend/BUILD.bazel  (existing)
├── :sources (existing)
├── :dist        (existing — produces dist.tar via `vite build` → emits dist/client/)
├── :ssr_dist    (NEW — produces ssr_dist.tar via `vite build --ssr` → emits dist/server/index.mjs)
├── :image (existing — nginx image, uses :dist via :assets_layer)
├── :image_tar (existing)
├── :ssr_image     (NEW — Node 20 slim base + :ssr_dist layer + :version_layer)
├── :ssr_image_tar (NEW — repo_tag = "dashboard-chat/web-ssr:bazel")
```

The two `oci_image` targets share the same source library (`:sources`) and the same `vite.config.ts`. Vite is invoked twice (once for client, once for SSR) — Vite supports this natively via `--ssr` and `build.rollupOptions.input` (per the Context7 RRv7 docs).

**Single source tree, two images.** ADR-033's layer separation principle survives intact: `frontend/` is the source body; `reverse-proxy` and `web-ssr` are the two topology services consuming the two images.

### 6.3 What the SSR image contains

```
/app/
├── frontend/
│   ├── ssr.mjs       — esbuild-bundled SSR entry (Hono + RRv7 createRequestHandler)
│   └── server/       — Vite SSR output (rollup'd from app/root.tsx + routes.ts + the entire src/ tree it imports)
└── (Node 20 slim runtime, no node_modules — bundled by esbuild like agent/)
```

The Bazel rule for `:ssr_dist` runs `vite build --ssr` then esbuilds `ssr.ts` with `--bundle --platform=node --format=esm` matching the `agent/` BUILD pattern (banner-injected `createRequire` so transitively bundled CJS deps load Node built-ins). Entry point: `node frontend/ssr.mjs`.

### 6.4 docker-compose entry

Per ADR-034 §"Topology":

```yaml
web-ssr:
  image: dashboard-chat/web-ssr:bazel
  pull_policy: never
  environment:
    AUTH_PROXY_URL: http://auth-proxy:3000
    NODE_ENV: ${NODE_ENV:-production}
  expose:
    - "3001"
  depends_on:
    auth-proxy:
      condition: service_started
```

**No host port mapping.** Reachable only from `reverse-proxy` over the compose network. Mirrors the `ui-state` pattern (also has `expose: 3001`-style internal port + no `ports:` mapping).

**Horizontal scaling property (explicit).** Like `ui-state`, `web-ssr` is designed for horizontal scaling: no session affinity, no fixed host port, and no `container_name` in the compose entry. Each instance is identical and stateless — request handlers construct their own request-scoped `QueryClient` (DWD-2), loaders read `Authorization` from the inbound request, and no state is held across requests. `docker compose up -d --scale web-ssr=N` is the supported scale-out path, matching `agent` and `auth-proxy`.

### 6.5 System-level deferral

This document covers the application-level shape of `:ssr_image`. The full Bazel target definitions, the `nginx.conf` location-block ordering, and the `docker-compose.yml` insertion **belong to the DELIVER wave**, not this DESIGN. The shape above is the spec DISTILL can write acceptance tests against.

---

## 7. Chat / SSE — clientLoader-only routes (DWD-3)

The `agent` chat surface streams SSE responses (`agent/index.ts:112-114` `app.post("/chat", ...)`). The `/api/channels/:id/presentation-state` endpoint (ADR-015) is a load-bearing nginx → agent direct rule.

**Routes that contain the chat (e.g. `ChatView` at `/`, `/chat/:channelId`) cannot SSR meaningfully:** the chat is a live stream of agent-emitted directives applied incrementally to a client-side TanStack table state. Server-side rendering of the *first frame* is fine; server-side data fetching of the live stream is not.

Per **DWD-3**, such routes:

1. **Do NOT export a server `loader`**. If they did, RRv7 would try to invoke it on the server, which means the SSR pass would either skip the chat data (and ship empty HTML that's identical to today's CSR-only output — harmless but pointless) or attempt to fetch SSE during the server pass (which would hang).
2. **MAY export a `clientLoader`** if they need route-data fetching, which RRv7 invokes only in the browser. The route is then effectively client-rendered with the same UX as today's SPA.
3. **MAY export an `ErrorBoundary`** for client-side error catching.

At MR-0 every route is library-mode (no `loader`, no `clientLoader`, no `ErrorBoundary`). The `clientLoader` pattern lands when (and only when) a chat-bearing route needs deferred client-side fetching — DWD-3 is the policy, not a code change for MR-0.

**Architecture invariant:** the `presentation-state` nginx rule (ADR-015) stays at the `reverse-proxy` layer and routes `/api/channels/:id/presentation-state` directly to the agent. If a future route's `loader` needs presentation state server-side, it fetches **through auth-proxy** (per ADR-031 §7 inheritance), not direct. ADR-015's rule is for client SSE consumers, not server-side prefetch — and there's no demonstrated need for server-side prefetch of presentation state.

---

## 8. Error boundary composition

RRv7 framework mode exposes three error-boundary scopes:

| Scope | Export | Catches |
|---|---|---|
| Root | `frontend/app/root.tsx :: ErrorBoundary` | Errors that escape any route's `ErrorBoundary`. The shell (`<Layout>`) wraps it so the document is still well-formed. |
| Per-route | `frontend/app/routes/<route>.tsx :: ErrorBoundary` | Errors in that route's loader or render. Renders inside the closest layout's `<Outlet />`. |
| Root layout fallback | `frontend/app/root.tsx :: Layout` wraps both default and error rendering | Used implicitly. No code change. |

**At MR-0**:
- `root.tsx` exports a basic `ErrorBoundary` (illustrative shape in §3.3).
- No per-route `ErrorBoundary` exports.

This is sufficient: errors caught at root display a generic 500-style message inside the shell. Per-route error boundaries are added as routes migrate to framework mode and gain loader-thrown error semantics.

---

## 9. Reversibility

Per ADR-034 §"Reversibility" — symmetric at two levels.

### 9.1 MR-0 reverse (rip out framework mode entirely)

```bash
# Net effect: SPA continues to render from the existing dist/client/ bundle served by nginx.
git revert <MR-0 commit>
# Removes:
#   - @react-router/dev + @react-router/node (from package.json)
#   - frontend/app/root.tsx + frontend/app/routes.ts + frontend/app/routes/*
#   - frontend/ssr.ts
#   - the new nginx location rule (system-level revert)
#   - the web-ssr compose service (system-level revert)
#   - the second Bazel oci_image target
# Restores:
#   - frontend/App.tsx + the <BrowserRouter><Routes>… declarations
#   - frontend/main.tsx (current shape — already preserved at MR-0 anyway)
#   - ui-presentation/ directory (the four scaffold files migrate back)
```

The SPA's `dist/client/` bundle from `vite build` (without the RRv7 plugin) is byte-compatible with the current state because: (a) the RRv7 plugin's only build-time effect at MR-0 is adding the SSR pass; (b) the client pass produces the same shape it does today (entrypoint = `main.tsx`, output = ES modules consumed by `index.html`). The SPA continues to work as a client-only React app from nginx — exactly the failure mode ADR-034 §"Decision drivers" anticipated as the reversibility property.

### 9.2 Per-route reverse (after future migrations)

Remove the `loader` export from a route module. The route reverts to library-mode (client-side render only). The component file imports do not change.

```ts
// before — framework-mode route with SSR'd data
export async function loader({ request, params }: LoaderFunctionArgs) { /* ... */ }
export default function Project() { /* uses useLoaderData() */ }

// after revert — library-mode route, client-side fetch
export default function Project() { /* uses TanStack Query directly */ }
```

The component switches its data-source line from `useLoaderData()` to a TanStack Query hook; the rest of the render is unchanged. **MR-sized change.**

---

## 10. What MR-0 ships exactly

The file-level list of MR-0 changes lives in [`handoff-design-to-distill.md` §"MR-0 scope"](./handoff-design-to-distill.md). Summary here:

**New files:**
- `frontend/app/root.tsx`
- `frontend/app/routes.ts`
- `frontend/app/routes/expired-token-banner.tsx` (moved from `ui-presentation/app/routes/`)
- `frontend/app/routes/expired-token-banner.test.tsx`
- `frontend/app/routes/recoverable-error.tsx`
- `frontend/app/routes/recoverable-error.test.tsx`
- `frontend/app/routes/copy-variants.ts`
- `frontend/app/lib/ui-state-client.ts` (the request-header-forwarding fetch helper from §4.1, ready for first loader migration)
- `frontend/ssr.ts`
- `frontend/build/.gitignore` (or `dist/`, depending on Vite output config — placeholder so Bazel sees the path)

**Modified files (application-level only):**
- `frontend/package.json` — adds `@react-router/dev`, `@react-router/node`, `hono`, `@hono/node-server`. (Hono is reusable from `agent/`'s lockfile path; alternatively add via root `package.json` workspace.)
- `frontend/vite.config.ts` — **adds `reactRouter()` from `@react-router/dev/vite` AND removes `@vitejs/plugin-react`** (the RRv7 plugin includes its own React-aware transformer; keeping both produces double React transforms and breaks the build). Also configures `build.outDir` if `dist/` (not the RRv7 default `build/`) is the chosen layout. **The plugin-react removal is non-negotiable and is part of MR-0's load-bearing edits.**
- `frontend/tsconfig.json` — includes `app/**/*.{ts,tsx}` in compilation.
- `frontend/App.tsx` — **DELETED at MR-0.** Its providers move to `root.tsx`; its `<Routes>` declarations move to `routes.ts`; its `RequireAuth`/`RequireOrg` helpers move into `AppShell`.
- `frontend/main.tsx` — **rewritten** to the RRv7 framework-mode hydration entry: `hydrateRoot(document, <StrictMode><HydratedRouter /></StrictMode>)` (imports `HydratedRouter` from `react-router/dom`). Explicit `main.tsx` retained for source-tree visibility.
- `frontend/src/ui/components/AppShell/index.tsx` — minor: continues to wrap children in `<QueryProvider>` at MR-0 (no-op alongside `root.tsx`'s `<QueryClientProvider>` — TanStack Query tolerates nested providers but issues a console warning; first migration MR removes the inner provider).
- `CLAUDE.md` — Frontend architecture block updates: `ui-presentation/` line collapses; one-line addition mentions RRv7 framework mode and `web-ssr` compose service. (Already partially anticipated by ADR-034 §"What's in the source tree.")

**Deleted (file-by-file):**
- `ui-presentation/` directory and all its contents.

**System-level changes (deferred to DELIVER for execution, listed here for completeness):**
- `frontend/BUILD.bazel` — second `oci_image` target.
- `frontend/nginx.conf` — one new `location` rule routing non-matched paths to `web-ssr:3001`.
- `docker-compose.yml` — new `web-ssr` service block.

---

## 11. Resolved open questions (from ADR-034)

ADR-034 §"Open questions" carries three items. Each is resolved below.

### 11.1 SSE / chat / `presentation-state` under SSR

**Resolved by DWD-3.** Routes that include the chat surface declare `clientLoader` only (or no loader at all). They do not declare a server `loader`. The `presentation-state` nginx rule (ADR-015) is untouched: it serves client-side SSE consumers from the agent directly. If a future loader needs presentation state server-side, it fetches through auth-proxy (per ADR-031 §7 inheritance), not direct.

### 11.2 Single workspace vs sibling workspace for the SSR artifact

**Resolved: single workspace (`frontend/`).** Rationale:

- The SSR bundle imports the same components as the client bundle (`frontend/src/ui/components/*`). A sibling workspace would force path-alias hops or a shared-internals package; a single workspace lets the SSR build see the entire `src/` tree via the same Vite config and the same `tsconfig.json` paths.
- The RRv7 Vite plugin assumes single-workspace.
- `ui-presentation/` dissolved partly because the sibling-workspace pattern was the failure mode ADR-034 §"Context" named ("two separate React runtimes, two separate AuthProvider mounts").
- Build-pipeline integrity: one `vite build` invocation produces both `dist/client/` and `dist/server/` (per RRv7's `--ssr` mode), so the source-set and dep-graph are guaranteed congruent.

### 11.3 `/api/channels/:id/presentation-state` under future migrations

**Resolved: nginx rule stays unchanged.** No future SSR'd route should declare a server `loader` that depends on presentation state — see §11.1 above. If a route does need presentation state server-side (a hypothesis not justified by any current use case), it fetches through auth-proxy via the standard ADR-031 §7 path. The agent-direct nginx rule remains specifically for the live SSE consumer pattern that ADR-015 designed it for.

---

## 12. What this DESIGN does NOT cover

Per the wave brief, the following are explicitly out of scope:

- **Implementation of MR-0** — DELIVER's job.
- **Tests** — DISTILL's job. See `handoff-design-to-distill.md` for the BDD scenarios DISTILL formalizes.
- **`vite.config.ts` exact line edits** — the decision to remove `@vitejs/plugin-react` and add `reactRouter()` is locked in §10 (non-negotiable load-bearing MR-0 edit). What's deferred to DELIVER is only the exact line positions, surrounding syntax, and any additional `build.outDir` / `optimizeDeps` configuration the RRv7 plugin happens to require.
- **`BUILD.bazel` exact additions** — system-level deferred to DELIVER.
- **`nginx.conf` exact additions** — system-level deferred to DELIVER.
- **`docker-compose.yml` exact additions** — system-level deferred to DELIVER.
- **Installation of `@react-router/dev`** — DELIVER's job.
- **Migration of `ui-presentation/` files** — DELIVER's job (MR-0 includes the move; DESIGN documents what moves where).

---

## 13. Cross-references

- ADR-034 (canonical): docs/decisions/adr-034-frontend-coexistence-via-rrv7-framework-mode.md
- ADR-033 (layer separation): docs/decisions/adr-033-source-tree-topology-separation.md
- ADR-031 §2, §7 (inherited): docs/decisions/adr-031-frontend-tier-transition-remix-alongside-nginx.md
- ADR-015 (load-bearing nginx rule): docs/decisions/adr-015-headless-presentation-state-retrieval.md
- ADR-027, ADR-028, ADR-029 (ui-state tier, XState v5, active_scope): same docs/decisions/ directory
- Sibling wave-decisions: [`./wave-decisions.md`](./wave-decisions.md)
- C4 diagrams: [`./c4-diagrams.md`](./c4-diagrams.md)
- Handoff to DISTILL: [`./handoff-design-to-distill.md`](./handoff-design-to-distill.md)
