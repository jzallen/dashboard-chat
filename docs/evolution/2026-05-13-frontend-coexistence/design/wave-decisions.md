# DESIGN Wave Decisions — `frontend-coexistence`

> **Wave**: DESIGN (application scope)
> **Date**: 2026-05-13
> **Companion**: [`application-architecture.md`](./application-architecture.md), [`c4-diagrams.md`](./c4-diagrams.md), [`handoff-design-to-distill.md`](./handoff-design-to-distill.md)
> **Driving ADR**: [ADR-034](../../../decisions/adr-034-frontend-coexistence-via-rrv7-framework-mode.md) (Accepted 2026-05-12 — immutable for this wave)

This file records the **binding contract decisions** made during DESIGN that are not already captured in an ADR. Each entry has a stable identifier (DWD-N) so DISTILL and DELIVER can cite them.

ADR-034's eight ratified decisions (substrate = RRv7 framework mode; Hono SSR container; single source tree; `ui-presentation/` dissolves; MR-0 is no-behavior-change plumbing; auth inherits ADR-031 §7; ADR-015 nginx rule preserved; trunk-based) are **immutable** for this wave and not re-stated here.

---

## DWD-1: `AuthProvider` remains client-only; loaders bypass it

**Decision**: `AuthProvider` (`frontend/src/ui/context/AuthContext/AuthProvider.tsx`) is mounted at the root of the React tree (in `root.tsx`) and stays the single source of truth for token state on the client. **Loaders do NOT construct a server-side `AuthProvider`.** Loaders read the Bearer token from `request.headers.get('Authorization')` and forward it as `Authorization` on outbound fetches to auth-proxy.

**Rationale**:

- `AuthProvider` owns purely browser-bound state: `sessionStorage`/`localStorage` reads, the inactivity timer (`setInterval`), and the `<ActivityCheckModal>` floating UI. None of these are meaningful server-side.
- The Bearer token is on the request headers because the browser is the source of truth (ADR-031 §7). Reconstructing it server-side from cookies or a state store would introduce a second auth surface — exactly the parallel-app failure mode ADR-034 §"Context" identifies.
- Side-stepping the client provider on the server matches the standard Remix v2 / RRv7 pattern (loaders are middleware-like functions; they read `request`, return data).

**How to apply**:

- Every loader that calls a downstream API uses the request-scoped client helper (`frontend/app/lib/ui-state-client.ts`) which copies `Authorization` from `request.headers` onto the outgoing fetch.
- No loader uses `useAuth()`. No loader uses React contexts (loaders are not React).
- `AuthProvider`'s render path is verified safe to render server-side (no `window`/`document`/`localStorage` access in render — only inside `useEffect`).

**Source**: [`application-architecture.md` §4.1](./application-architecture.md), ADR-031 §7 (inherited verbatim).

---

## DWD-2: TanStack Query SSR via `dehydrate` / `<HydrationBoundary>`

**Decision**: Loaders that fetch data via TanStack Query construct a **request-scoped** `QueryClient`, prefetch with `client.prefetchQuery({...})`, then call `dehydrate(client)` and return the dehydrated state in the loader return value. The route component wraps its tree in `<HydrationBoundary state={dehydratedState}>`. The browser's **singleton** `QueryClient` (mounted in `root.tsx` via `useState(() => new QueryClient(...))`) merges the dehydrated cache state on first render.

**Rationale**:

- Module-scoped `new QueryClient()` (today's `frontend/src/ui/providers/QueryProvider.tsx:5`) is **unsafe on the server** — it would be shared across requests, leaking user data.
- TanStack Query v5 ships `dehydrate` / `HydrationBoundary` precisely for this seam. No bespoke serialization needed.
- The browser's `QueryClient` survives navigations (singleton via `useState` lazy init), so per-route prefetches accumulate into one client-side cache — exactly the SPA's current behavior.

**How to apply**:

- `root.tsx` initializes the browser `QueryClient` via `const [queryClient] = useState(() => new QueryClient(...))` and wraps `<QueryClientProvider>` around `<Outlet />`.
- Any loader that prefetches: `const client = new QueryClient(); await client.prefetchQuery(...); return { dehydratedState: dehydrate(client), ...other };`.
- The route component pulls `dehydratedState` from `useLoaderData()` and wraps its children in `<HydrationBoundary state={dehydratedState}>`.
- At MR-0 no loader exists; this DWD becomes load-bearing in the first per-route migration.

**Source**: [`application-architecture.md` §4.2](./application-architecture.md), TanStack Query SSR docs (well-known pattern; consulted via Context7).

---

## DWD-3: SSE-bearing routes opt out of server-side SSR via `clientLoader`-only

**Decision**: Any route module that includes the agent chat surface (`ChatView`) or otherwise depends on a client-only resource (SSE streams, WebSockets, browser-only sensors) **does NOT export a server `loader`**. It MAY export a `clientLoader` (invoked only in the browser) for deferred client-side data fetching. The `/api/channels/:id/presentation-state` nginx rule (ADR-015) is preserved unchanged.

**Rationale**:

- The agent's `POST /chat` SSE stream is intrinsically client-side; server-side prefetch has no meaning.
- ADR-015's `presentation-state` rule routes a specific path directly to the agent (bypassing auth-proxy) for *client-side* SSE consumers. It is not a server-prefetch endpoint.
- Declaring a `loader` on a chat-bearing route would either (a) waste a server round-trip producing empty SSR output, or (b) attempt to fetch SSE during the SSR pass and hang. Neither is acceptable.
- `clientLoader` is the framework-mode escape hatch RRv7 provides for exactly this case.

**How to apply**:

- The route component file declares only `export default function RouteComponent()` (and optionally `export function ErrorBoundary`).
- If client-side data fetching is needed beyond what TanStack Query inside the component does today, the file may add `export async function clientLoader({request, params}) { ... }`.
- Lint rule (deferred, optional): a custom ESLint rule could flag a `loader` export co-located with a chat-bearing component import. Not required at MR-0.
- At MR-0 no chat-bearing route has a loader (no route has any loader). The DWD codifies the policy for future migrations.

**Source**: [`application-architecture.md` §7](./application-architecture.md), ADR-015 (preserved), ADR-034 §"Open questions" item 1 (resolved by this DWD).

---

## DWD-4: `ui-presentation/` migration is part of MR-0 (not a separate MR)

**Decision**: The four scaffold files in `ui-presentation/app/routes/` (`copy-variants.ts`, `expired-token-banner.tsx`, `expired-token-banner.test.tsx`, `recoverable-error.tsx`, `recoverable-error.test.tsx` — five files, originally listed as four in ADR-034 because test files were elided) **move into `frontend/app/routes/` in the same MR that introduces RRv7 framework mode**. The `ui-presentation/` directory is deleted in MR-0.

**Rationale**:

- ADR-034 §"What's in the source tree" already specifies this: "`ui-presentation/` is **dissolved**. Its four scaffold files migrate into `frontend/app/routes/` as the first real RRv7 route modules under framework mode."
- Splitting the dissolution into a separate MR would leave a half-state where `ui-presentation/` exists alongside the new `frontend/app/routes/` directory — exactly the parallel-app failure mode the ADR retires.
- The five files are tiny (~150 LOC combined) and have no compose-service ownership today (they're scaffold-only per `ui-presentation/package.json:23` `"//SCAFFOLD": "Step 02-01: minimal Remix-styled module shape per ADR-031. Component-only, not yet wired into compose."`). Their migration is a `git mv` that preserves history.
- At their new home in `frontend/app/routes/`, they remain pure component modules. They DO NOT gain `loader` exports in MR-0 — they continue to be library-mode (no SSR data fetching) until a subsequent MR migrates them to framework mode.

**How to apply**:

- `git mv ui-presentation/app/routes/* frontend/app/routes/`.
- Update imports in the moved files: `./copy-variants.ts` paths remain relative (no change). External imports from other parts of the codebase that referenced `ui-presentation/` paths get updated (search the repo for `ui-presentation` to surface any).
- Delete `ui-presentation/package.json`, `ui-presentation/tsconfig.json`, `ui-presentation/vitest.config.ts`, `ui-presentation/package-lock.json`, and the `ui-presentation/` directory itself.
- Remove `"ui-presentation"` from the root `package.json` `workspaces` array.
- CLAUDE.md's `ui-presentation/` block in the architecture section collapses to a single sentence about RRv7 framework mode in `frontend/app/routes/`.

**Source**: [`application-architecture.md` §10](./application-architecture.md), ADR-034 §"What's in the source tree" (binding text).

---

## DWD-5: SSR image is built via Bazel `oci_image`, not a standalone Dockerfile

**Decision**: The new `web-ssr` container's image is built via a second `oci_image` target in `frontend/BUILD.bazel`, mirroring `agent/BUILD.bazel`'s pattern (esbuild bundle + `node_20_slim` base). The image tag is `dashboard-chat/web-ssr:bazel`. **There is no `ssr.Dockerfile`** in `frontend/`.

**Rationale**:

- ADR-034 §"What's in the source tree" lists "`ssr.Dockerfile` (NEW — Hono + RRv7 SSR runtime; imports `dist/server/`)". This wording is shorthand for "build recipe for the SSR image."
- `frontend/` today contains **no `Dockerfile`**. The existing nginx-based image is built fully in Bazel via `oci_image` (`@nginx_alpine` base + 4 tar layers — see `frontend/BUILD.bazel:355-368`).
- Inheriting the Bazel pattern for the SSR image preserves consistency with `frontend/BUILD.bazel` (same build system) and with `agent/BUILD.bazel` (same Node runtime base + esbuild bundle).
- ADR-033's "one source tree, multiple topology services" principle is satisfied exactly the same way: `frontend/BUILD.bazel` gains a second `image_tar` target.
- The `ui-state/` and `auth-proxy/` services do use a `Dockerfile` rather than Bazel; that's a known pattern divergence (they're newer and have not yet migrated to Bazel). Following them would diverge from `frontend/`'s existing Bazel build, which is the closer sibling.

**How to apply** (system-level, deferred to DELIVER for exact code):

- In `frontend/BUILD.bazel`, add `:ssr_dist` (genrule: `vite build --ssr` + esbuild bundle of `ssr.ts` → produces `ssr_dist.tar` containing `ssr.mjs` + `server/` bundle).
- Add `:ssr_image` (`oci_image`, base `@node_20_slim`, tars `:ssr_dist` + `:version_layer`, entrypoint `["node", "frontend/ssr.mjs"]`, exposed port `3001`).
- Add `:ssr_image_tar` (`oci_load`, `repo_tags = ["dashboard-chat/web-ssr:bazel"]`).
- The existing `:image` / `:image_tar` (nginx) targets are unchanged.

**Source**: [`application-architecture.md` §6](./application-architecture.md), comparison with `agent/BUILD.bazel:84-104`, ADR-034 §"Build pipeline".

---

## DWD-6: `App.tsx` is deleted at MR-0; `main.tsx` is rewritten to the RRv7 hydration entry

**Decision**: At MR-0, `frontend/App.tsx` is **DELETED** (not "deprecated", not "optionally removed" — deleted, in the same MR that introduces RRv7 framework mode). Its three responsibilities are redistributed:

| `App.tsx` responsibility | New home |
|---|---|
| `<AuthProvider>` mount | `frontend/app/root.tsx :: <Root>` |
| `<Routes>` JSX declarations | `frontend/app/routes.ts` (RRv7 route config) |
| `RequireAuth` / `RequireOrg` helpers | `frontend/src/ui/components/AppShell/index.tsx` (or a colocated `guards.tsx` next to it) |

`frontend/main.tsx` reduces from `ReactDOM.createRoot(...).render(<StrictMode><BrowserRouter><App/></BrowserRouter></StrictMode>)` to the RRv7 framework-mode hydration entry (`<HydratedRouter />` from `react-router/dom`, wrapped in `<StrictMode>` for parity).

**Rationale**:

- ADR-034 §"What's in the source tree" implies this: `App.tsx` is not in the new layout. `root.tsx` is the new root; `routes.ts` declares the route surface.
- Keeping `App.tsx` alongside `root.tsx` at MR-0 would produce two competing route declarations — exactly the dual-truth failure mode the ADR retires.
- `BrowserRouter` is incompatible with RRv7 framework mode; the framework provides its own client-side router instance via `<HydratedRouter />`.
- The `RequireAuth`/`RequireOrg` guards are not routing concerns; they're conditional render concerns that today happen to be expressed as wrapper components inside `<Route element={…}>`. Moving them into `<AppShell>` (or a sibling guards file) is structurally cleaner — `<AppShell>` already reads `useAuth()` (per `frontend/src/ui/components/AppShell/index.tsx`'s imports of `useOrgQuery` etc.); pulling the guard logic inside it keeps the auth-coupling local.

**How to apply** (DELIVER's exact code; DESIGN specifies shape):

- Delete `frontend/App.tsx`.
- Migrate the `RequireAuth` / `RequireOrg` function bodies (lines 19–30 of today's `App.tsx`) into `<AppShell>`'s top-of-render or into `frontend/src/ui/components/AppShell/guards.tsx`.
- Rewrite `frontend/main.tsx` to the RRv7 client entry.

**Source**: [`application-architecture.md` §3.5](./application-architecture.md).

---

## DWD-7: At MR-0, `AppShell` continues to wrap children in `<QueryProvider>`

**Decision**: At MR-0, `frontend/src/ui/components/AppShell/index.tsx:55-59` continues to wrap its children in `<QueryProvider>`. The root-level `<QueryClientProvider>` (in `root.tsx`) and the AppShell-inner `<QueryProvider>` coexist. The redundant inner provider is removed in the **first per-route migration MR** that adds a loader to an AppShell-nested route.

**Rationale**:

- Removing the inner `<QueryProvider>` at MR-0 would require auditing every AppShell child for hard-coded reliance on the inner client identity (e.g., `import { queryClient } from "@/providers/QueryProvider"`). At MR-0 we commit to no-behavior-change; that audit is the wrong scope.
- TanStack Query tolerates nested `<QueryClientProvider>` (the inner one wins for descendants). The behavior under MR-0 is byte-identical to today's SPA: AppShell children read from the AppShell-inner client. The root-level client exists for the (not-yet-existing) loader-prefetched routes that mount outside `<AppShell>` (e.g., `/login`).
- The deferred cleanup is a one-line edit; deferring it preserves MR-0's no-behavior-change posture and minimizes review surface.

**How to apply**:

- MR-0: no change to `AppShell`'s `<QueryProvider>` wrapping.
- First per-route migration MR (the one that introduces the first `loader` returning a `dehydratedState`): replace the inner `<QueryProvider>` mount with the root-level singleton, deleting `frontend/src/ui/providers/QueryProvider.tsx`'s module-scoped `queryClient` export.

**Source**: [`application-architecture.md` §3.5, §10](./application-architecture.md).

---

## DWD-8: `nginx.conf` rule ordering is preserved; the new catch-all routes to `web-ssr` last

**Decision** (system-level, called out here because it affects application-level correctness): the new nginx rule that routes non-matched paths to `http://web-ssr:3001` is **inserted after** the existing five rules (`/api/channels/:id/presentation-state` regex, `/api/` prefix, `/worker/` prefix, `/health` exact, `/assets/` prefix). The SPA-fallback `location /` block (today: `try_files $uri $uri/ /index.html`) **changes role**: at MR-0 it becomes `proxy_pass http://web-ssr:3001` (with the `try_files` removed). nginx still serves `/assets/*` directly.

**Rationale**:

- ADR-034 §"Topology" specifies one new proxy rule for "non-static, non-API routes." The existing five rules must precede it so prefix/regex precedence is unchanged.
- The catch-all `location /` is the natural home for the new rule because it already handles the not-matched-by-anything-else case.
- `/assets/*` (Vite-emitted static bundle) keeps its dedicated `location /assets/` block with 1-year cache headers — unchanged by MR-0.
- The migration is structural, not byte-identical: the SPA fallback was a `try_files` returning `index.html`; the new rule is a `proxy_pass` to a Node server that **returns HTML for the same routes**. Functionally equivalent (the browser still receives an HTML document at `/` that bootstraps the SPA), structurally different (the HTML is now SSR'd by RRv7's library-mode pass-through pass).

**How to apply** (system-level, DELIVER):

- Modify `frontend/nginx.conf` so `location /` becomes:
  ```nginx
  location / {
      resolver 127.0.0.11 valid=10s;
      set $web_ssr_upstream http://web-ssr:3001;
      proxy_pass $web_ssr_upstream;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_http_version 1.1;
  }
  ```
- The four preceding regex/prefix rules are unchanged.
- The `/assets/` cache rule is unchanged.

**Source**: [`application-architecture.md` §5.1](./application-architecture.md), ADR-034 §"Topology", current `frontend/nginx.conf`.

---

## Decisions deferred (not made during DESIGN)

The following are flagged for DELIVER or future waves:

- **First route to migrate to framework mode.** Subject to product priorities — likely `/login` for UX reasons (SSR'd first paint avoids login-screen blank-flash) and per ADR-029's mention of `root.tsx` reading the `login-and-org-setup` projection. Not load-bearing for MR-0.
- **Whether `frontend/main.tsx` survives.** RRv7's dev plugin auto-generates the hydration entry if it's absent; an explicit `main.tsx` makes the entry visible in the source tree. Recommendation deferred — DELIVER picks based on what the plugin emits in practice.
- **Custom ESLint rule for "no `loader` co-located with chat import"** (DWD-3 enforcement). Optional; not required at MR-0.
- **Bazel target name** — `:ssr_image` vs `:web_ssr_image` vs other. Bikeshedding-level; DELIVER picks.
- **Whether RRv7's `prerender` feature is enabled for any static-ish routes** (e.g., the auth `/login` page). Not in scope for MR-0; can be turned on per-route with `prerender = true` in `routes.ts` config later.
