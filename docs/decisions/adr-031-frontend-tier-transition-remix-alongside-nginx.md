# ADR-031: Frontend Tier Transition — Remix Runs Alongside nginx, Not in Place of It

**Status:** Accepted (ratified 2026-05-11)
**Date:** 2026-05-11
**Originating wave:** DESIGN — `user-flow-state-machines` (system-scope pass)
**Author:** Titan (nw-system-designer)
**Companion artifacts:**
- System-scope deliverable: `docs/feature/user-flow-state-machines/design/system-architecture.md`
- Sibling ADRs (same wave): ADR-027 (host tier + framework), ADR-028 (XState v5 actor model), ADR-029 (`active_scope` propagation), ADR-030 (topology + scaling)
- Inherited: ADR-015 (presentation-state log routing rule in nginx)

## Context

ADR-027 selected Remix v2 as the frontend framework (over Option B's plain SPA fallback). Morgan's `application-architecture.md` §2 shows the new container as `Frontend (Remix on Vite)` — implying the existing `reverse-proxy` container's process model changes from "nginx serving static `dist/` + reverse-proxy" to "Node running Remix server."

That implication has system-level consequences Morgan's application-scope pass did not enumerate:

1. The current `reverse-proxy/nginx.conf` does **four** routing things, not one. It's the SPA static server AND a reverse-proxy for `/api/*` (→ auth-proxy), `/worker/*` (→ agent direct), `/api/channels/:id/presentation-state` (→ agent direct per ADR-015), `/health` (→ auth-proxy), AND it does gzip + static-asset caching + late-binding DNS resolution.
2. The ADR-015 routing rule (`/api/channels/:id/presentation-state` → agent direct) is **load-bearing** — it's the only way headless harnesses retrieve the directive log. It must not be lost.
3. Replacing nginx with Remix's Node server means re-implementing all four routing rules + gzip + caching + DNS-late-binding in JavaScript. Doable, but unnecessary churn for no system-level benefit.

The decision is what physical deployment shape the Remix server takes vis-à-vis the existing nginx container.

## Decision drivers

- **Preserve mature, working infrastructure.** nginx's reverse-proxy semantics, gzip, caching, and late-binding DNS resolution are mature and work today. Replacing them is unnecessary work with no payoff.
- **ADR-015's routing rule is load-bearing.** `reverse-proxy/nginx.conf:16-23` proxies `/api/channels/:id/presentation-state` to the agent directly (bypassing auth-proxy). This is a deliberate architectural decision per ADR-015 / `dc-x3y.2.2`; reimplementing it in Remix loaders is a regression risk.
- **Strangler-fig migration shape.** The current SPA is comprehensive; Remix migration is route-by-route. The migration is far easier if both the SPA and Remix can run simultaneously, with nginx routing specific paths to one or the other.
- **Reversibility.** If Remix turns out to be a problem (lock-in, perf, team learning curve), rolling back should be a config change, not a re-architecture.
- **Build pipeline impact.** `make up` builds Bazel-managed images; adding a new image is the same pattern as the existing four (frontend, agent, auth-proxy, api). Adding a new image is cheaper than rewriting the frontend image.

## Considered options

1. **Option R1 — Remix Node server replaces nginx outright.** `reverse-proxy/` container becomes a Node process running Remix's compiled server. Static asset serving, SPA fallback, reverse-proxy, gzip, caching: all reimplemented in Remix or surrounding middleware.

2. **Option R2 — Remix Node server runs BEHIND nginx in the same container.** nginx routes `/` and Remix-owned routes to a localhost Node process (Remix). nginx keeps `/api/`, `/worker/`, `/health`, `/assets/`. Two processes in one container, managed by `s6-overlay` or similar.

3. **Option R3 — Remix container as a separate compose service.** A new `ui-presentation` container runs Remix's Node server. nginx in the existing `reverse-proxy` container is unchanged except for one new upstream rule (proxy migrated routes to `ui-presentation:3001`). The two containers can be deployed and rolled back independently. **Selected.**

## Decision outcome

### 1. Topology: Remix as a separate compose service

Compose addition:

```yaml
# docker-compose.yml addition
ui-presentation:
  image: dashboard-chat/ui-presentation:bazel
  pull_policy: never
  environment:
    AUTH_PROXY_URL: http://auth-proxy:3000
    # Remix loaders fetch projections through auth-proxy; AUTH_PROXY_URL
    # is the same name + value the agent already uses (compose network).
    NODE_ENV: ${NODE_ENV:-production}
  expose:
    - "3001"
  # No host-port mapping — only reachable from the reverse-proxy nginx container.
  depends_on:
    auth-proxy:
      condition: service_started
```

`reverse-proxy/nginx.conf` gains a single new rule:

```nginx
# Migrated routes go to Remix.
# Today: /login, /org/$org, /org/$org/project/$project.
# Expands as the strangler-fig migration proceeds (one PR per route family).
location ~ ^/(login|org)(/|$) {
    resolver 127.0.0.11 valid=10s;
    set $remix_upstream http://ui-presentation:3001;
    proxy_pass $remix_upstream;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_http_version 1.1;
}
```

The existing nginx rules (`/api/`, `/worker/`, `/api/channels/:id/presentation-state`, `/assets/`, gzip, SPA fallback) are **byte-unchanged**. The Remix migration is purely additive at the nginx layer.

### 2. What stays in nginx (unchanged)

- SPA fallback for all non-migrated routes (`try_files $uri $uri/ /index.html`).
- `/api/*` → auth-proxy.
- `/api/channels/:id/presentation-state` → agent direct (ADR-015 load-bearing rule).
- `/worker/*` → agent direct.
- `/health` → auth-proxy.
- gzip on text MIME types.
- `/assets/` cache headers (`expires 1y`, `Cache-Control: public, immutable`).
- `resolver 127.0.0.11` for late-binding DNS.

### 3. What Remix owns

- Server-side route loaders for the migrated routes.
- Loader fetches go through auth-proxy (Bearer-delegated; the user's token is forwarded as Authorization header from the browser to Remix to auth-proxy).
- Server-side rendering of migrated routes.

Remix does NOT own:
- Static asset serving (nginx + `/assets/` cache).
- Any reverse-proxy concern.
- Auth verification (auth-proxy does this; Remix loaders trust the auth-proxy response).

### 4. Strangler-fig migration sequence

| Phase | Routes on Remix | Routes on SPA | Trigger |
|---|---|---|---|
| 1 (PR-0) | `/login`, `/org/$org` | All others | This feature's DELIVER |
| 2 | + `/org/$org/project/$project` | All others | Next J-002 DESIGN |
| 3..N | One route family per migration | The rest | Per future flow's DESIGN |
| N+1 | All routes | none | When SPA fallback has no consumers |
| Cleanup | n/a | (SPA removed; nginx routes everything to Remix; only static assets stay in nginx) | Final cleanup PR |

At every phase, both the SPA and Remix coexist; nginx is the routing arbiter. Rollback at any phase is a one-line `nginx.conf` revert.

### 5. Build pipeline impact

Bazel build graph gains one new target: `//ui-presentation:image`. Same pattern as the existing `//reverse-proxy:image`, `//agent:image`, `//auth-proxy:image`, `//api:image`. No new image build patterns; no new tooling.

The existing `frontend` Bazel target is unchanged — it still builds an nginx image with `dist/` static output. Build time grows by ~30-60 seconds for the new image; the two images build in parallel.

### 6. RAM and runtime footprint

| Service | Before | After |
|---|---|---|
| `frontend` (nginx) | ~10 MB | ~10 MB (unchanged) |
| `ui-presentation` (NEW) | n/a | ~150 MB (Node + Remix runtime + libs) |

Total addition: ~150 MB per host. Cheap.

### 7. Auth path (resolves SQ-6 from system-architecture.md)

- The browser sends Bearer token in Authorization header (PR-0 behavior; cookie migration in Phase B post-feature).
- nginx forwards the header to `ui-presentation` (default `proxy_set_header` behavior includes upstream forwarding).
- Remix loaders read `request.headers.get("Authorization")` and use it as the Bearer when calling auth-proxy.
- Auth-proxy verifies (unchanged behavior).
- Auth-proxy forwards identity headers to the ui-state tier.

Phase B (post-feature, separate ADR) migrates to HTTP-only cookies. The architecture supports either; PR-0 commits to Bearer to minimize migration scope.

### 8. Compose acceptance test impact

The compose acceptance stack grows from 5 services (ADR-016: backend + worker + auth-proxy + query-engine + MinIO) to **7 services** (add `ui-state` per ADR-030 + `ui-presentation` per this ADR).

Per ADR-016, this is a topology change worth annotating: the test stack must include both new services to verify production-fidelity ingress paths. The compose acceptance test's structural assertions (per Morgan's `application-architecture.md` §10 enforcement layer) MUST verify all 7 services start byte-identically.

## Consequences

### Positive

- **Zero churn to a working nginx config.** The existing 6 routing rules (including ADR-015's load-bearing one) are untouched. Risk of regression in proxy semantics, gzip, caching, or DNS late-binding is eliminated.
- **Strangler-fig migration is mechanically clean.** Each route migration is a 5-line nginx.conf change + a new Remix route file. Rollback per route is a one-line revert.
- **Independent restart and roll-forward shapes.** `frontend` and `ui-presentation` containers restart independently; a deploy bug in one doesn't take down the other.
- **Build pipeline parallelism.** Bazel can build the two images concurrently.
- **Reversibility is structural.** If Remix proves wrong, the entire `ui-presentation` container is deleted, and the corresponding nginx routes revert to the SPA fallback. The ui-state tier (the load-bearing piece per ADR-027) is framework-independent and unaffected.

### Negative / accepted trade-offs

- **One additional container in compose.** ~150 MB RAM, same Bazel pattern. Cheap.
- **Two containers to monitor in the frontend tier.** Operators must health-check both. Mitigated by clear container naming (`frontend` for nginx, `ui-presentation` for Node) and per-container `/health` endpoints.
- **nginx config grows over time** as more routes migrate to Remix. Each route family adds a `location ~ ^/(family)(/|$)` rule. Mitigated by clear naming and a single review point per migration PR.
- **The "frontend" mental model splits into "static SPA + Remix server."** Until the SPA is fully retired, both are live. Mitigated by the per-route migration sequence in §4 and a public migration tracker (DELIVER concern).

### Cross-decision composition

- **ADR-031 ↔ ADR-027**: ADR-027 selected Remix; ADR-031 specifies how Remix lands in compose without disturbing nginx.
- **ADR-031 ↔ ADR-015**: ADR-031 preserves the `reverse-proxy/nginx.conf` `/api/channels/:id/presentation-state` rule verbatim. ADR-015 is honored.
- **ADR-031 ↔ ADR-016**: the compose acceptance stack grows to 7 services; ADR-016's "test topology = production topology" principle continues to apply.
- **ADR-031 ↔ ADR-030**: Remix loaders call auth-proxy; auth-proxy routes `/ui-state/*` to the new tier per ADR-030.

## Open questions

1. **Should the `frontend` and `ui-presentation` containers eventually merge** (e.g., via a unified ingress that does both static asset serving and Remix SSR)? Reasonable long-term direction, but not a PR-0 concern. Revisit when the strangler-fig migration completes (phase N+1).

2. **CDN insertion** (TLS termination, edge caching, geographic routing). Out of scope for PR-0; relevant when production deployment scale grows. The architecture supports it: nginx → CDN insertion (CDN in front, nginx as origin) is a standard pattern.

3. **HTTP/2 + HTTP/3 push for Remix asset payloads.** Today's nginx config is HTTP/1.1 by default; Remix's payloads can benefit from HTTP/2 multiplexing. Optimization for later; not feature-blocking.

## References

- System-architecture.md §4 (full trade-off analysis of R1/R2/R3)
- `reverse-proxy/nginx.conf` (current routing rules, including ADR-015's load-bearing rule at lines 16-23)
- `docker-compose.yml` (current frontend container definition at lines 3-10)
- Morgan's `application-architecture.md` §2 (the Remix-on-Vite implication this ADR clarifies)
- ADR-015 (presentation-state log routing), ADR-016 (compose topology fidelity), ADR-027 (Remix framework selection)
