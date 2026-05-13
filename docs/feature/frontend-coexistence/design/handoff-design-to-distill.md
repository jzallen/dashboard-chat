# DESIGN → DISTILL Handoff — `frontend-coexistence`

> **Wave**: DESIGN (application scope) → DISTILL
> **Date**: 2026-05-13
> **From**: nw-solution-architect (DESIGN wave)
> **To**: acceptance-designer (DISTILL wave)
> **Status**: ADR-034 ratified 2026-05-12; DESIGN artifacts (this set) commit the application-architecture detail. DISTILL formalizes the BDD scenarios this document sketches.
> **Companion**: [`application-architecture.md`](./application-architecture.md), [`wave-decisions.md`](./wave-decisions.md), [`c4-diagrams.md`](./c4-diagrams.md)

---

## TL;DR

DESIGN ratified for the **application layer** (system layer was settled by ADR-034):

- **Substrate**: React Router v7 framework mode, `react-router-dom@7.13.0` already installed.
- **Runtime**: new Hono container `web-ssr` mirrors `agent/` and `ui-state/`. Bazel-built `oci_image` (DWD-5).
- **Provider tree**: `root.tsx` mounts `<QueryClientProvider>` (request-scoped server, singleton browser) + `<AuthProvider>` (client-only, DWD-1) + `<HydrationBoundary>` (TanStack Query SSR, DWD-2).
- **Routing**: `routes.ts` declares all existing routes library-mode at MR-0. Per-route migration adds a `loader` export to opt in to SSR.
- **`App.tsx` and `<BrowserRouter>` are deleted at MR-0** (DWD-6). `<AuthProvider>` moves to `root.tsx`; `RequireAuth`/`RequireOrg` move into `AppShell`.
- **`ui-presentation/` dissolves into `frontend/app/routes/` in the same MR** (DWD-4). All 5 scaffold files migrate.
- **Chat-bearing routes opt out of SSR** via `clientLoader`-only pattern (DWD-3). ADR-015's nginx rule preserved.
- **Reversibility**: MR-0 revertible by removing the SSR plumbing; per-route revertible by removing the `loader` export.

8 DWDs recorded (see `wave-decisions.md`). Three of ADR-034's open questions resolved.

---

## 1. MR-0 scope — exact file-level list

MR-0 is **no-behavior-change plumbing**. The app renders identically to pre-MR-0 from the browser's perspective.

### 1.1 New files (`frontend/app/`)

```
frontend/app/root.tsx                                  — SSR-aware root. Owns <html>/<head>/<body> shell, top-level
                                                          providers (QueryClient + AuthProvider + HydrationBoundary),
                                                          global ErrorBoundary. See application-architecture.md §3.3.
frontend/app/routes.ts                                 — RRv7 route config. Declares all 12 existing routes (one of
                                                          which is the AppShell layout containing 11 nested routes).
                                                          Every entry is library-mode (no loader). See §3.4 of the
                                                          architecture doc for the exact shape.
frontend/app/lib/ui-state-client.ts                    — Request-header-forwarding fetch helper. Loaders use this.
                                                          Dormant at MR-0 (no loader calls it yet).
frontend/ssr.ts                                        — Hono entry. Mounts /health + delegates everything else to
                                                          @react-router/node :: createRequestHandler. See §5 of
                                                          the architecture doc.
```

### 1.2 New files (`frontend/app/routes/` — `git mv` from `ui-presentation/app/routes/`)

```
frontend/app/routes/copy-variants.ts                   — was: ui-presentation/app/routes/copy-variants.ts
frontend/app/routes/expired-token-banner.tsx           — was: ui-presentation/app/routes/expired-token-banner.tsx
frontend/app/routes/expired-token-banner.test.tsx      — was: ui-presentation/app/routes/expired-token-banner.test.tsx
frontend/app/routes/recoverable-error.tsx              — was: ui-presentation/app/routes/recoverable-error.tsx
frontend/app/routes/recoverable-error.test.tsx         — was: ui-presentation/app/routes/recoverable-error.test.tsx
```

These remain pure component modules. No `loader` exports. They are addressable from `routes.ts` only if they are wired into the route surface; at MR-0 they are unwired (they're the staging ground for future migrations, as ADR-034 §"What's in the source tree" specifies).

### 1.3 Modified files (application-level)

```
frontend/App.tsx                                       — DELETED. <AuthProvider> moves to root.tsx; <Routes>
                                                          declarations move to routes.ts; RequireAuth/RequireOrg
                                                          guards move into AppShell.
frontend/main.tsx                                      — Reduced to RRv7 hydration entry:
                                                            import { StrictMode } from "react";
                                                            import { hydrateRoot } from "react-dom/client";
                                                            import { HydratedRouter } from "react-router/dom";
                                                            hydrateRoot(document, <StrictMode><HydratedRouter/></StrictMode>);
frontend/package.json                                  — Adds devDeps: @react-router/dev, @react-router/node, hono,
                                                          @hono/node-server. (Hono is already in agent/'s lockfile;
                                                          the workspace setup determines whether it's hoisted.)
frontend/vite.config.ts                                — Adds `reactRouter()` from @react-router/dev/vite to the
                                                          plugins array AND removes the existing `react()` entry
                                                          from `@vitejs/plugin-react`. NON-OPTIONAL: keeping both
                                                          plugins produces double React transforms and breaks the
                                                          build. Configures build.outDir if MR-0 chooses dist/ over
                                                          the RRv7 default build/.
frontend/tsconfig.json                                 — Adds `app/**/*` to the `include` array (or equivalent).
frontend/src/ui/components/AppShell/index.tsx          — Receives the RequireAuth/RequireOrg guard logic from
                                                          App.tsx (top-of-render conditionals or a colocated
                                                          frontend/src/ui/components/AppShell/guards.tsx file).
                                                          Continues to wrap children in <QueryProvider> at MR-0
                                                          (DWD-7 — removed in the first per-route migration).
CLAUDE.md                                              — Architecture section: ui-presentation/ block collapses to
                                                          one sentence about RRv7 framework mode in frontend/app/.
                                                          Adds web-ssr to the compose services list.
```

### 1.4 Deleted (directories + files)

```
ui-presentation/                                        — Entire directory deleted (after the 5 file mv's). Includes:
ui-presentation/app/                                       app/routes/ (moved files above)
ui-presentation/package.json                               
ui-presentation/tsconfig.json                              
ui-presentation/vitest.config.ts                           
ui-presentation/package-lock.json                          
package.json (root)                                     — REMOVE "ui-presentation" from workspaces array.
```

### 1.5 System-level changes (deferred to DELIVER for code; specified here for completeness)

```
frontend/BUILD.bazel                                   — Adds :ssr_dist (vite --ssr + esbuild bundle of ssr.ts),
                                                          :ssr_image (oci_image, base @node_20_slim),
                                                          :ssr_image_tar (repo_tags = ["dashboard-chat/web-ssr:bazel"]).
                                                          Existing :image / :image_tar (nginx) unchanged.
                                                          See DWD-5 and application-architecture.md §6.
frontend/nginx.conf                                    — `location /` block: `try_files $uri $uri/ /index.html;`
                                                          REPLACED with `proxy_pass http://web-ssr:3001` + standard
                                                          proxy headers + resolver. Existing /api/, /worker/,
                                                          /api/channels/:id/presentation-state, /health, /assets/
                                                          rules byte-unchanged.
                                                          See DWD-8.
docker-compose.yml                                     — Inserts a web-ssr block:
                                                            web-ssr:
                                                              image: dashboard-chat/web-ssr:bazel
                                                              pull_policy: never
                                                              environment:
                                                                AUTH_PROXY_URL: http://auth-proxy:3000
                                                                NODE_ENV: ${NODE_ENV:-production}
                                                              expose: ["3001"]
                                                              depends_on:
                                                                auth-proxy:
                                                                  condition: service_started
                                                          The reverse-proxy block gets a depends_on edge to web-ssr
                                                          if startup ordering matters.
e2e/run-e2e.sh                                         — May need a web-ssr build target if E2E exercises the SSR
                                                          path. Likely no change required for MR-0 (the browser
                                                          flows through reverse-proxy → web-ssr → existing services
                                                          and the test should be transparent).
.github/workflows/ci.yml                               — If a Bazel target list is enumerated, add :ssr_image_tar.
```

---

## 2. Migration playbook — worked example: migrating `/login` to framework mode

This is the canonical recipe for **any** route that opts into SSR after MR-0. It applies once MR-0 has landed.

**Pre-conditions** (all MR-0 artifacts present):

- `frontend/app/root.tsx` exists with `<QueryClientProvider>` + `<AuthProvider>` + `<HydrationBoundary>`.
- `frontend/app/routes.ts` declares `/login` as `route("/login", "src/ui/components/LoginPage/index.tsx")` (library-mode pass-through).
- `frontend/app/lib/ui-state-client.ts` exists.
- `web-ssr` container is up.

### Step 1 — Identify the data the route needs server-side

For `/login`: per ADR-029 §2 the root loader is the place that reads the `login-and-org-setup` projection. (Strictly speaking the **root loader** owns `active_scope`, but `/login` is a route nested under the root; for the first migration we may pull the projection at root.tsx or at the `/login` route module — DELIVER picks based on what the first per-route migration MR scopes.) Assume `/login` itself adds the loader for this worked example.

### Step 2 — Move the route module under `frontend/app/routes/`

```
git mv frontend/src/ui/components/LoginPage/index.tsx frontend/app/routes/login.tsx
```

(Or: keep the component file where it is and reference it via the existing `route("/login", "...index.tsx")` path. Either layout is supported by RRv7. The DELIVER MR-1 picks; the playbook accommodates both.)

For the *physical move* path:

- Update imports in `routes.ts`:
  ```ts
  // before
  route("/login", "src/ui/components/LoginPage/index.tsx"),
  // after
  route("/login", "app/routes/login.tsx"),
  ```
- The component file's imports of its colocated assets (CSS, etc.) survive relative-path-wise.

### Step 3 — Add a `loader` export

```ts
// frontend/app/routes/login.tsx — illustrative
import { dehydrate, QueryClient, HydrationBoundary } from "@tanstack/react-query";
import { useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { uiStateClient } from "~/app/lib/ui-state-client";

const LOGIN_FLOW_KEY = ["projection", "login-and-org-setup"] as const;

export async function loader({ request }: LoaderFunctionArgs) {
  const client = new QueryClient();
  await client.prefetchQuery({
    queryKey: LOGIN_FLOW_KEY,
    queryFn: () => uiStateClient(request).getProjection("login-and-org-setup"),
  });
  return { dehydratedState: dehydrate(client) };
}

export default function LoginRoute() {
  const { dehydratedState } = useLoaderData<typeof loader>();
  return (
    <HydrationBoundary state={dehydratedState}>
      <LoginPage />
    </HydrationBoundary>
  );
}
```

The `<LoginPage>` component itself is **unchanged** — it continues to use its existing TanStack Query hooks. Those hooks now read from a pre-seeded cache instead of triggering a network fetch on mount.

### Step 4 — Verify SSR locally

```bash
docker compose build reverse-proxy web-ssr
docker compose up -d
curl -i http://localhost:5173/login
# Expect: 200 text/html with the LoginPage's heading text in the HTML payload (NOT just an empty <div id="root">).
```

### Step 5 — Land the MR

`gt mq submit --branch migrate/route-login`. The refinery's `--auto` gate runs `tools/test/test.sh --ui` (frontend tests) plus `--backend` if anything Python changed (won't for this MR).

### Step 6 — Verify reversibility

Drop the `loader` export. The route reverts to library-mode; `<LoginPage>` fetches its data client-side on mount. **No code change to LoginPage itself.** Verify by running the same `curl` and observing the response is now an HTML shell with no SSR'd content (the shell + the `<Scripts>` bootstrap; the data fetches client-side).

---

## 3. BDD-style acceptance scenarios

The following scenarios are the **acceptance-test boundary** DISTILL formalizes into runnable suites. The scenarios are grouped by what they verify and which DWD or ADR clause they enforce.

Conventions: `Given/When/Then` per Gherkin. "The system" = the compose topology after MR-0 lands. "A migrated route" = a route that gained a `loader` export in a subsequent MR.

### 3.1 MR-0 ships and the app renders identically (no-behavior-change)

**ADR-034 §"Migration sequence" row 1 — load-bearing for MR-0.**

```gherkin
Scenario: MR-0 visual parity at the entry route
  Given the topology before MR-0 (reverse-proxy only, no web-ssr container)
  When a browser requests "/"
  Then it receives 200 text/html with an HTML shell that bootstraps the SPA
   And the rendered DOM after hydration matches a known fingerprint <F>

  Given the topology after MR-0 (reverse-proxy + web-ssr, all routes library-mode)
  When a browser requests "/"
  Then it receives 200 text/html with an HTML shell that bootstraps the SPA
   And the rendered DOM after hydration matches the same fingerprint <F>

Scenario: MR-0 preserves the five existing nginx rules
  Given the topology after MR-0
  When a request is sent to "/api/anything"
  Then it is proxied to auth-proxy (NOT web-ssr)

  When a request is sent to "/worker/chat"
  Then it is proxied to agent (NOT web-ssr)

  When a request is sent to "/api/channels/test-id/presentation-state"
  Then it is proxied to agent directly (NOT web-ssr, NOT auth-proxy)

  When a request is sent to "/health"
  Then it is proxied to auth-proxy (NOT web-ssr)

  When a request is sent to "/assets/some-bundle.js"
  Then it is served by nginx static (NOT web-ssr)

Scenario: MR-0 reaches web-ssr for the catch-all
  Given the topology after MR-0
  When a request is sent to "/login"
  Then it is proxied to web-ssr (a Hono process that returns SSR'd HTML or library-mode shell)

  When a request is sent to "/projects/some-id"
  Then it is also proxied to web-ssr
```

**Enforces**: ADR-034 §"Topology", DWD-8, ADR-015 (preservation).

### 3.2 A route migrated to framework mode SSRs its initial HTML

**DWD-2 + the RRv7 substrate.**

```gherkin
Scenario: A route with a loader SSRs server-fetched data
  Given a route module at frontend/app/routes/<route>.tsx that exports a server `loader`
   And the loader prefetches data via uiStateClient(request).getProjection(...)
   And the loader returns `{ dehydratedState: dehydrate(client) }`
  When a browser requests "/<route>" with an Authorization header
  Then the response is 200 text/html
   And the response body contains the server-rendered route component output
   And the response body contains a serialized form of the dehydratedState (consumed by HydrationBoundary on the client)

Scenario: The browser's TanStack Query cache is hydrated from the loader's prefetched data
  Given an SSR'd response from the scenario above
  When the browser parses the HTML and runs the hydration entry
  Then the singleton QueryClient mounted by root.tsx merges the dehydratedState into its cache
   And the route component renders WITHOUT issuing a second fetch to ui-state for the same queryKey
```

**Enforces**: DWD-2, ADR-027 (projection endpoint contract).

### 3.3 A migrated route reverts to library-mode by removing its `loader` export (reversibility)

**DWD-2 negative branch + ADR-034 §"Reversibility".**

```gherkin
Scenario: Removing a route's loader reverts it to library-mode behavior
  Given a route module that previously exported a server `loader`
  When the `loader` export is removed (and the route module is left as a pure component)
   And the topology is rebuilt
  When a browser requests "/<route>"
  Then the response is still 200 text/html (the web-ssr container still serves it)
   But the response body does NOT contain pre-rendered route-specific content
   And the response body contains an HTML shell + the client bundle reference
   And the route component fetches its data client-side after hydration (matches pre-migration behavior)
```

**Enforces**: ADR-034 §"Reversibility" per-phase clause.

### 3.4 A route that includes the chat stream opts out of SSR via `clientLoader` only

**DWD-3 + ADR-015 (preservation).**

```gherkin
Scenario: A chat-bearing route does NOT declare a server `loader`
  Given a route module at frontend/app/routes/chat.<channelId>.tsx whose component imports ChatView
  Then the route module MUST NOT export a `loader`

Scenario: A chat-bearing route MAY declare a `clientLoader`
  Given a route module at frontend/app/routes/chat.<channelId>.tsx
  When the route declares `export async function clientLoader({request, params}) { ... }`
  Then the clientLoader runs ONLY in the browser, not during SSR
   And the SSR response for "/chat/<channelId>" is an HTML shell (no clientLoader output)
   And the browser executes clientLoader after hydration

Scenario: The presentation-state endpoint is reached directly via the existing nginx rule
  Given a browser viewing "/chat/<channelId>"
  When the ChatView component fetches "/api/channels/<channelId>/presentation-state"
  Then the request is routed by nginx directly to the agent (per ADR-015)
   And the request does NOT pass through web-ssr, auth-proxy, or api

Scenario: No future route's server loader fetches presentation-state directly
  Given a code review of any frontend/app/routes/*.tsx file with a server `loader`
  Then the loader MUST NOT make a server-side fetch to "/api/channels/.../presentation-state" directly
   And if a route needs presentation-state server-side, it routes through auth-proxy (per ADR-031 §7)
   (Enforced by code review / optional ESLint custom rule, not at runtime.)
```

**Enforces**: DWD-3, ADR-015 (preservation), ADR-031 §7 (auth path inheritance for any future SSR'd presentation-state consumer).

### 3.5 `ui-presentation/` dissolution is complete (DWD-4 verification)

```gherkin
Scenario: ui-presentation directory does not exist after MR-0
  Given the topology after MR-0
  Then the path "ui-presentation/" MUST NOT exist as a directory
   And the root package.json "workspaces" array MUST NOT include "ui-presentation"

Scenario: The five scaffold files are addressable at their new location
  Given the topology after MR-0
  Then the file frontend/app/routes/copy-variants.ts exists
   And the file frontend/app/routes/expired-token-banner.tsx exists
   And the file frontend/app/routes/expired-token-banner.test.tsx exists
   And the file frontend/app/routes/recoverable-error.tsx exists
   And the file frontend/app/routes/recoverable-error.test.tsx exists
   And the vitest suite for those files passes when invoked from frontend/
```

**Enforces**: DWD-4, ADR-034 §"What's in the source tree".

### 3.6 `AuthProvider` remains client-only (DWD-1)

```gherkin
Scenario: No loader instantiates AuthProvider
  Given a code review of any frontend/app/routes/*.tsx file
  Then no loader function calls `new AuthProvider(...)` or imports AuthProvider as a value used inside the loader
   And no loader reads identity state from any context — loaders use `request.headers.get('Authorization')` only

Scenario: AuthProvider renders safely server-side
  Given the SSR pass for any route
  When react-router/node renders the route tree (including root.tsx → AuthProvider)
  Then AuthProvider's render output does NOT call `window`, `document`, `sessionStorage`, or `localStorage` at render time
   And no error is thrown
   And on the client, after hydration, AuthProvider's useEffects fire and the token is read from sessionStorage as today
```

**Enforces**: DWD-1.

### 3.7 `App.tsx` is deleted and `<BrowserRouter>` does not appear in MR-0 (DWD-6)

```gherkin
Scenario: App.tsx is absent
  Given the topology after MR-0
  Then the file frontend/App.tsx MUST NOT exist

Scenario: BrowserRouter is not imported anywhere in frontend/
  Given the topology after MR-0
  Then `grep -r "BrowserRouter" frontend/` returns no matches in source files (test files MAY use MemoryRouter)
```

**Enforces**: DWD-6.

### 3.8 The compose topology gains exactly one container (web-ssr)

```gherkin
Scenario: Container count delta is +1
  Given docker-compose.yml after MR-0
  Then `docker compose config --services` lists web-ssr as a new service
   And the existing 6 application services (reverse-proxy, auth-proxy, agent, api, ui-state, redis) are present
   And no application service was removed
   And web-ssr does NOT expose a host port (only `expose: 3001` internally)
```

**Enforces**: ADR-034 §"Topology", DWD-5.

---

## 4. Out of scope for DISTILL

Do NOT write acceptance tests for these — DELIVER's job:

- The exact Bazel target additions in `frontend/BUILD.bazel`.
- The exact nginx `location` block syntax.
- The exact `docker-compose.yml` block ordering.
- The exact `vite.config.ts` plugin configuration.
- The exact `frontend/main.tsx` hydration call.
- The runtime behavior of `<HydratedRouter />` (RRv7-internal).

DISTILL focuses on **observable behavior** (HTTP requests, response shapes, file presence/absence, code-review-style invariants).

---

## 5. Suggested acceptance suite layout

A suite at `tests/acceptance/frontend-coexistence/` with its own `pyproject.toml` + venv per the CLAUDE.md acceptance-suite convention. Likely subdivision:

```
tests/acceptance/frontend-coexistence/
├── pyproject.toml
├── conftest.py
├── test_mr0_topology.py            — scenarios in §3.1, §3.5, §3.8
├── test_ssr_route_migration.py     — scenarios in §3.2, §3.3
├── test_chat_clientloader_only.py  — scenarios in §3.4
└── test_app_tsx_deletion.py        — scenarios in §3.7 (static-analysis style)
```

Topology-shape tests are easy headless HTTP requests against the compose stack. DOM-fingerprint tests (§3.1) likely need a Playwright invocation; reuse the existing E2E harness scaffold.

---

## 6. Risks DISTILL should be aware of

- **Vite plugin co-existence**: `@react-router/dev/vite` and `@vitejs/plugin-react` overlap in React-transform responsibility. The RRv7 plugin includes its own React transformer; the `@vitejs/plugin-react` entry should be **removed** from `vite.config.ts` to avoid double-transforms. This is a DELIVER-time tactical detail surfaced by the RRv7 docs.
- **Module-scoped `queryClient` exported from `frontend/src/ui/providers/QueryProvider.tsx`**: this is a server-side hazard if any loader imports it. Loaders MUST construct their own request-scoped client (DWD-2). DELIVER may want to delete the module-scoped export and let `<AppShell>`'s inner provider construct its own (or, better, drop the inner provider entirely after the first migration MR — see DWD-7).
- **Lazy-load chunks**: the SPA today uses no explicit React.lazy. RRv7 framework mode emits per-route chunks automatically. Bundle layout changes; CDN cache keys may shift. Not a behavioral change, but a deploy/cache concern flagged for DELIVER.
- **Path aliases**: the existing Vite config declares aliases like `@/auth`, `@/chat`. RRv7's `tsconfig` may want a `~/app/...` alias for the new tree. Coexistence is fine; document the convention DELIVER picks.
- **The `clientLoader` vs `loader` lint rule** (DWD-3 enforcement): optional but valuable. If DELIVER adds it, write tests against it.

---

## 7. Cross-references

- ADR-034 (canonical): `docs/decisions/adr-034-frontend-coexistence-via-rrv7-framework-mode.md`
- ADR-031 §2, §7: `docs/decisions/adr-031-frontend-tier-transition-remix-alongside-nginx.md`
- ADR-015: `docs/decisions/adr-015-headless-presentation-state-retrieval.md`
- ADR-029: `docs/decisions/adr-029-active-scope-propagation-contract.md`
- Application architecture (this wave): [`./application-architecture.md`](./application-architecture.md)
- Wave decisions (this wave): [`./wave-decisions.md`](./wave-decisions.md)
- C4 diagrams (this wave): [`./c4-diagrams.md`](./c4-diagrams.md)
