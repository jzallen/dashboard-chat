# ADR-034: Frontend coexistence via React Router v7 framework mode (supersedes ADR-031 §1, §3, §4)

**Status:** Accepted (2026-05-12) · execution deferred (separate PRs to follow)
**Date:** 2026-05-12
**Originating wave:** ad-hoc review of ADR-031's strangler-fig framing
**Companion artifacts:**
- Supersedes: [ADR-031](adr-031-frontend-tier-transition-remix-alongside-nginx.md) §1 (topology), §3 (what Remix owns), §4 (migration sequence), §"Considered options" R1/R2/R3
- Inherits unchanged: ADR-031 §2 (what stays in nginx), §7 (auth path)
- Related: [ADR-033](adr-033-source-tree-topology-separation.md) (source-tree/topology layer separation — applied here)
- Reviewer: nw-solution-architect (foreground analysis, 2026-05-12)

## Context

ADR-031 proposed a strangler-fig migration from the existing Vite/React SPA to a Remix-based SSR tier, with two compose services (`reverse-proxy` for the SPA, `ui-presentation` for Remix) and nginx routing each request to the appropriate service. As of 2026-05-12 the rename plumbing exists (`ui-presentation/` directory present, package.json scaffold-marked) but no Remix code, no compose service, no nginx routing rule, and no Bazel target have been wired.

Re-examining ADR-031 under the question "does the proposed coexistence pattern actually achieve coexistence?" surfaces a structural problem: **two compose services means two separate React runtimes, two separate `AuthProvider` mounts, two separate TanStack Query caches, and two separate copies of the 60+ components under `frontend/src/ui/components/`**. ADR-031 §4 sequences a multi-month phased migration without budgeting for how shared chrome (`AppShell`, `SideNav`), shared auth context (`AuthProvider` wraps the entire SPA tree at `frontend/App.tsx`), shared design system, or shared query state will be available to Remix routes. The unresolved options are: duplicate into `ui-presentation/`, extract to a shared package, or accept visible UX seams at every cross-service navigation. None of these are stated in ADR-031.

The overseer's framing names this directly: "the strangler-fig is useless unless the new implementation coexists with the legacy implementation — otherwise we're just building two apps in parallel trying to maintain feature parity with both." This is the failure mode ADR-031's plan walks into by Phase 2.

A separately-discovered fact reframes the decision: `frontend/package.json` already declares `react-router-dom: ^7.13.0`. The Remix and React Router projects merged upstream; **React Router v7 framework mode IS the Remix successor**. The same `react-router-dom` package the SPA already uses can declare loader-bearing route modules that SSR via a Node runtime, without installing any `@remix-run/*` package and without forking the React tree.

## Decision drivers

- **Single React tree.** Shared components, auth context, query cache, and design system live in one place; library-mode and framework-mode routes coexist inside one `<Routes>` declaration without duplication.
- **Single runtime.** One Node container holds the SSR engine; it imports the SSR build artifact and serves the SPA static bundle as fallback. nginx's existing five rules are preserved verbatim.
- **Migration is route-level inside the tree**, not process-level across containers. Each migrated route is one route module file gaining a `loader` export.
- **Reversibility is structural.** Removing the `@react-router/dev/vite` plugin and deleting `frontend/app/routes/` returns the codebase to a client-only React SPA. No data migration, no state-shape divergence to unwind.
- **Avoid the parallel-app failure mode** ADR-031 doesn't budget for.
- **ADR-033 separation principle held.** Source-tree directory `frontend/` is one body of source. The compose topology has two services (`reverse-proxy` nginx-fronted-static, `web-ssr` Hono+SSR). The two services share one `frontend/BUILD.bazel` producing two OCI images. Layer separation is the durable pattern.

## Considered options

1. **Single Node runtime, mixed routing inside one Hono server.** A Hono container serves the Vite `dist/client/` as static for non-migrated routes and invokes SSR for migrated routes. Two outputs from one Vite config. Components shared by path alias. Single React tree at runtime.
2. **Remix v2 on Vite (`@remix-run/dev/vite` plugin), single Vite config.** Single source tree builds both client and SSR bundles. Same shape as option 1 but with Remix v2 dependencies layered on top of the existing `react-router-dom@7` — two router APIs concurrently.
3. **React Router v7 framework mode.** The SPA's existing router gains framework mode via `@react-router/dev/vite`. Loader-bearing route modules under `frontend/app/routes/` SSR via a Node runtime; non-loader routes stay client-only via library mode. **No new router API — RRv7 framework mode is the upstream successor to Remix v2.**
4. **Module federation / micro-frontend mounting.** Heavy infrastructure for the lightest organizational reality (one team, one product, one deploy cadence). Skip.
5. **Astro-style server shell with SPA islands.** Optimizes for content-heavy pages with light interactive surface. Dashboard Chat is overwhelmingly interactive (chat streams, live tables, XState flows). Skip.
6. **Status quo: ADR-031 two-services pattern.** The failure mode the overseer named. Skip.

## Decision outcome

**Option 3 — React Router v7 framework mode.** Runner-up: Option 1 (Hono + handcrafted SSR over the existing Vite build) as a fallback if RRv7 framework mode proves immature in practice.

### Topology (supersedes ADR-031 §1)

```yaml
# docker-compose.yml addition — replaces the ui-presentation: block ADR-031 proposed
web-ssr:
  image: dashboard-chat/web-ssr:bazel
  pull_policy: never
  environment:
    AUTH_PROXY_URL: http://auth-proxy:3000
    NODE_ENV: ${NODE_ENV:-production}
  expose:
    - "3001"
  # No host-port mapping — only reachable from the reverse-proxy nginx container.
  depends_on:
    auth-proxy:
      condition: service_started
```

The `web-ssr` container is a **Hono server** (matches `agent/` and `ui-state/` runtime choice). Hono imports the RRv7 SSR request handler and dispatches inbound requests through it. Static asset fallback continues to be served by the existing `reverse-proxy` nginx container.

`frontend/nginx.conf` adds one proxy rule for non-static, non-API routes (route everything else to `web-ssr`); the five existing rules (`/api/`, `/worker/`, `/api/channels/:id/presentation-state` per ADR-015, `/health`, `/assets/`) are byte-unchanged.

### Build pipeline

The existing `frontend/vite.config.ts` gains the `@react-router/dev/vite` plugin alongside `@vitejs/plugin-react`. A single `vite build` produces:

- `dist/client/` — the SPA client bundle (today's existing output, byte-compatible)
- `dist/server/` — the SSR entry that the `web-ssr` container imports

`frontend/BUILD.bazel` gains a second OCI image target (`//frontend:web_ssr_image_tar` alongside the existing `//frontend:image_tar`). One source directory produces two compose-service-bound images; this is the layer separation ADR-033 anticipated.

### What's in the source tree

```
frontend/
├── package.json           (existing)
├── vite.config.ts         (gains @react-router/dev/vite plugin)
├── nginx.conf             (gains one new location block)
├── BUILD.bazel            (gains a second image_tar target)
├── Dockerfile             (existing nginx-based; unchanged)
├── ssr.Dockerfile         (NEW — Hono + RRv7 SSR runtime; imports dist/server/)
├── ssr.ts                 (NEW — Hono entry; mounts RRv7 request handler)
├── app/
│   ├── root.tsx           (NEW — RRv7 SSR-aware root; replaces App.tsx's role)
│   ├── routes.ts          (NEW — route config; declares existing routes as library-mode initially)
│   └── routes/            (NEW — files migrate here as they gain loaders)
└── src/                   (existing — all components, auth, lib, core)
    └── ui/components/     (existing — imported from both library-mode and framework-mode routes)
```

`ui-presentation/` is **dissolved**. Its four scaffold files (`copy-variants.ts`, `expired-token-banner.tsx`, `recoverable-error.tsx`, plus tests) migrate into `frontend/app/routes/` as the first real RRv7 route modules under framework mode. The two-directory frontend tier collapses back to one directory. CLAUDE.md's architecture block is amended.

### Migration sequence

| Phase | What lands | Visible behavior change | Reversibility |
|---|---|---|---|
| **PR-0** | RRv7 framework-mode plumbing (vite plugin, ssr.ts, root.tsx, routes.ts declaring existing routes as library-mode), Hono SSR container, Dockerfile, Bazel target, compose service, nginx rule, dissolve `ui-presentation/` | **None.** App renders identically. Bundle size essentially unchanged. SSR is on but every route is library-mode so the SSR pass is a thin pass-through. | Delete the new Bazel target + the SSR container + the nginx rule + revert the four new files. |
| **Phase 1+ (one PR per route)** | A route module gains a `loader` export. That route now SSRs. The component file under `frontend/src/ui/components/` is unchanged — it receives `useLoaderData()` instead of fetching client-side. | Only the migrated route changes (SSR'd HTML, server-fetched initial state). All other routes unchanged. | Remove the `loader` export from the route file. Route reverts to library-mode. |
| **Final (optional)** | The SPA shell in `main.tsx` is dropped if every route is framework-mode. The `BrowserRouter` in App.tsx goes away. | None visible. The framework-mode root is the only root. | Add `BrowserRouter` back. |

Migration order is **driven by which routes most need SSR** (auth pages for UX, shareable URLs for metadata, etc.), not by "what's mechanically easy to extract." A route is migrated when it needs SSR; routes that don't need SSR can stay library-mode forever. There is no "must migrate all routes" deadline.

### Auth path (inherits ADR-031 §7 with one substitution)

ADR-031 §7's auth path survives verbatim with one substitution: "Remix loaders read `request.headers.get('Authorization')`" becomes "RRv7 framework-mode loaders read `request.headers.get('Authorization')`". Same headers, same auth-proxy forwarding, same token-passing pattern. The auth contract is framework-incidental.

### ADR-015 routing rule

The `/api/channels/:id/presentation-state` → agent direct rule is **load-bearing and unchanged**. It stays in nginx's existing config. RRv7's new nginx rule applies only to routes that don't match the existing five.

## What ADR-031 keeps

- **Don't rewrite nginx.** Five existing rules preserved verbatim.
- **One new compose service** for SSR (renamed from `ui-presentation` to `web-ssr`).
- **Bazel one-image-per-service** pattern extends to the new image.
- **Migration is route-by-route** with per-route reversibility.
- **§2 (what stays in nginx)** is byte-identical to ADR-031.
- **§7 (auth path)** is byte-identical to ADR-031 with the framework-name substitution above.

## What ADR-031 supersedes

- **§1 (Topology — two services with two React trees).** Replaced with: one Node SSR runtime + the existing nginx static-serving container. Both render from one React tree.
- **§3 (What Remix owns).** Replaced with: RRv7 framework-mode loaders own server-side data fetching for migrated routes; RRv7 library mode owns client-side rendering for non-migrated routes; both are the same router in the same component tree.
- **§4 (Strangler-fig migration sequence — phased route family table).** Replaced with: PR-0 is no-behavior-change plumbing; subsequent PRs add one `loader` at a time as routes need SSR. No phase-N+1 SPA retirement deadline — routes can stay library-mode indefinitely if they don't need SSR.
- **§"Considered options" R1/R2/R3.** Subsumed by the option space above (which adds RRv7 framework mode, single-Hono mixed routing, federation, and islands as comparanda).

## Consequences

### Positive

- **Source-of-truth React tree.** `AppShell`, `SideNav`, `AuthProvider`, TanStack Query cache, design system — all live in `frontend/src/` and are imported by every route, library-mode or framework-mode, with no duplication.
- **Migration is opt-in and gradual.** Routes that don't need SSR don't have to migrate. Routes that do migrate are one-file changes.
- **Reversibility is structural, not rhetorical.** The SPA continues to work as a client-only React app if framework mode is removed. No data migration to unwind.
- **The load-bearing dependency is already installed.** `react-router-dom@7.13.0` is in `frontend/package.json` today. New deps are `@react-router/dev` (Vite plugin), `@react-router/node` (Node SSR adapter), and Hono (already used by `agent/` and `ui-state/`).
- **Honors ADR-033 layer separation.** Source-tree: one `frontend/` directory. Topology: two compose services (`reverse-proxy`, `web-ssr`) sharing one source body. The bridging point is two image_tag lines in `frontend/BUILD.bazel`.
- **`ui-presentation/` confusion dissolves.** The scaffold-only directory absorbs into `frontend/app/routes/`. CLAUDE.md's two-paragraph explanation of `ui-presentation/`'s scaffold state collapses to a single sentence about RRv7 framework mode.

### Negative / accepted trade-offs

- **One source dir produces two images.** Slightly novel; ADR-033 §"Future evolution" anticipated this case. The BUILD.bazel divergence is explicit and commented.
- **Two Dockerfiles in `frontend/`** (the existing nginx-based one for `reverse-proxy`; the new SSR one for `web-ssr`). Same source tree, different runtime concerns.
- **RRv7 framework mode is recent** (v7 GA late 2024). Sharp edges possible. Mitigation: Option 1 (handcrafted Hono SSR over Vite) is the structural fallback if RRv7 plugin proves immature.

### Neutral

- The `agent/` and `ui-state/` Hono services are unchanged. This ADR is only about the frontend tier.
- The XState actor model (ADR-028) is unaffected. UI-state and the frontend tier remain separately deployed; the frontend (SSR or SPA) calls `ui-state` over HTTP.
- ADR-031's reversibility framing was directionally correct but structurally weak in its proposed form. The reversibility property survives in this ADR with stronger structural grounding.

## Open questions

1. **Is there an SSR data-fetching concern with the agent's SSE-streamed chat and the `presentation-state` endpoints?** Routes that include the chat surface (e.g., an eventual `/chat/:channelId`) would have RRv7 loaders trying to render server-side, but the chat stream is intrinsically client-side (SSE). Pragmatic answer: those routes opt out of SSR via `clientLoader` only. Flag during the relevant route's migration PR; not a blocker for PR-0.

2. **Should the SSR build artifact ship in the same npm workspace as the SPA, or as a sibling workspace?** RRv7's Vite plugin assumes single-workspace. The current `frontend/` is already one workspace. Default: keep as one workspace; PR-0 confirms.

3. **What happens to ADR-015's `/api/channels/:id/presentation-state` rule under future route migrations?** Unchanged today. If a future Remix-rendered route needs to call `presentation-state` from its loader, the loader fetches it through auth-proxy (per ADR-031 §7 inheritance), not direct. Re-evaluate if a route actually needs it server-side.

## Reversibility

The forward and reverse migrations are symmetric:

- **Forward (per phase):** Add a `loader` export to a route module file. Verify the route SSRs. PR-sized change.
- **Reverse (per phase):** Remove the `loader` export. Verify the route renders client-only. PR-sized change.
- **Forward (PR-0 plumbing):** Add four new files + nginx rule + compose service + Bazel target.
- **Reverse (rip out framework mode entirely):** Remove those same four files + the nginx rule + the compose service + the Bazel target. The SPA continues to work as a client-only React app from the existing `dist/client/` bundle served by nginx.

## Method note

This ADR is the third in a same-day sequence of architectural decisions (ADR-031 ratified, ADR-032 partially superseded by ADR-033, now ADR-034 supersedes parts of ADR-031). The rapid iteration is intentional: each ADR ratifies a hypothesis, the implementation surfaces what was true vs aspirational, and the next ADR refines. ADR-031's two-services framing was the working hypothesis; the post-rename inspection (this session's nw-solution-architect critique) surfaced the parallel-app failure mode the framing produces. Recording the iteration in successive ADRs is more honest than rewriting ADR-031 in place to pretend the decision was always this.

## References

- [ADR-031](adr-031-frontend-tier-transition-remix-alongside-nginx.md) — the partially-superseded predecessor
- [ADR-033](adr-033-source-tree-topology-separation.md) — source-tree/topology layer separation principle this ADR applies
- [ADR-015](adr-015-presentation-state-routing.md) — load-bearing nginx rule preserved verbatim
- [ADR-028](adr-028-xstate-actor-model.md) — `ui-state/` actor model (unaffected; frontend tier is decoupled)
- React Router v7 framework mode docs: https://reactrouter.com/start/framework/installation
- Remix → React Router v7 merger announcement: https://remix.run/blog/incremental-path-to-react-19
