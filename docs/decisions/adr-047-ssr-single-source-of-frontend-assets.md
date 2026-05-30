# ADR-047: The SSR build is the single source of frontend assets (amends ADR-034 §"Build pipeline" / §Topology)

**Status:** Accepted (2026-05-30)
**Date:** 2026-05-30
**Originating wave:** DESIGN (infrastructure scope) — root-cause fix for the web-ssr ↔ reverse-proxy asset-hash 404 class
**Issue:** dc-1kw
**Companion artifacts:**
- Amends: [ADR-034](adr-034-frontend-coexistence-via-rrv7-framework-mode.md) §"Build pipeline" (two outputs) and §Topology (nginx serves static assets)
- Inherits unchanged: [ADR-034](adr-034-frontend-coexistence-via-rrv7-framework-mode.md) (single React tree, single runtime, route-level migration), [ADR-033](adr-033-source-tree-topology-separation.md) (one source body → two OCI images)
- Related: [ADR-015](adr-015-headless-presentation-state-retrieval.md) (presentation-state nginx rule — preserved verbatim)

## Context

ADR-034 introduced a two-image frontend topology: the `frontend/` source body produces (1) a `reverse-proxy` nginx image serving `dist/client/` statics + routing, and (2) a `web-ssr` Hono image hosting the RRv7 SSR request handler. ADR-034 §"Build pipeline" assumed *one* `vite build` emitting `dist/client` + `dist/server`, both consumed downstream.

The implementation diverged from that assumption. `frontend/BUILD.bazel` ended up running `react-router build` **twice**, in two independent `no-sandbox` genrules:

- `dist` → staged into the nginx `assets_layer` (reverse-proxy serves `/assets/*` statically).
- `ssr_dist` → web-ssr's `build/server` **and its own** `build/client`.

Two independent builds must agree on Vite's content-hash filenames (`AuthContext-<hash>.js`) for the SSR-rendered HTML (which references hashes from web-ssr's build) to resolve against the files nginx actually serves (from the `dist` build). They diverged for two compounding reasons:

1. **Environment skew** between the two genrules (partially patched in dc-zdq / ddda6c7).
2. **Shared mutable build dir under `no-sandbox`.** Both genrules run `react-router build` in the *same* source `frontend/build/` directory. They stomp each other and, worse, *accumulate* stale hashed assets across runs — `frontend/build/` is an untracked side effect Bazel does not clean. Bazel's disk cache then serves stale genrule tars keyed on inputs that don't capture the dirty `build/` state. The reverse-proxy image accreted multiple `AuthContext-*.js` variants over time.

**Net effect:** web-ssr's SSR'd HTML references `/assets/*.js` content-hashes that the nginx static layer never serves → a 404 on every chunk → blank app. This is a structural defect in the *dual-build* topology, not a one-off env bug; patching the env (ddda6c7) narrows the window but cannot close it while two builds and a dirty shared dir exist.

The refinery merge-queue gate is **backend-only** — it never builds or tests the frontend — so this class of defect is invisible to CI and only surfaces at runtime. The durable fix must remove the *possibility* of divergence, not merely re-align the two builds.

### Product-owner intent (authoritative)

> The SSR build is the single source of frontend assets. nginx (reverse-proxy) MAY remain for app coordination/routing, but frontend assets must come from the SSR build, not a separate nginx static build.

## Decision drivers

- **Single asset owner — divergence becomes structurally impossible.** If exactly one build emits exactly one copy of the hashed assets and exactly one process serves them, there is no second set of hashes to disagree with.
- **Determinism.** The build must not accumulate stale assets across runs; the served set must contain exactly one variant of each chunk.
- **Honor the gate's blind spot.** Because the gate won't catch frontend regressions, the topology must make the failure mode unrepresentable rather than relying on test coverage that does not run.
- **Minimal topology churn.** Keep ports, compose service names, and the five load-bearing nginx rules (ADR-031 §2 / ADR-015) stable. One source body → two OCI images (ADR-033) is preserved.

## Considered options

**Option A — nginx proxies `/assets/*` → web-ssr; web-ssr is the sole asset owner.** A *single* `react-router build` emits `build/client` + `build/server`, both packaged into the `web-ssr` image. web-ssr's Hono app serves `build/client` statically. nginx's `/assets/` rule changes from static-serve to a proxy to web-ssr (keeping the `immutable` cache header). The `dist` genrule and the nginx `assets_layer` are **deleted** — the reverse-proxy image carries no frontend assets at all. One build, one copy, one server.

**Option B — one genrule, shared build output consumed by both images.** A single `react-router build` emits `build/client` once; both the reverse-proxy `assets_layer` and the web-ssr image consume *that identical output*. nginx still serves statics, but from byte-identical files to web-ssr's manifest. Collapses to one build (fixes determinism + env skew) but keeps two serving surfaces and two physical copies of the assets that must be packaged in lockstep.

Both collapse to a **single `react-router build`**. The difference is whether assets are served from one place (A) or copied into two images that must stay in lockstep (B).

## Decision outcome

**Option A.** The SSR build is the single source of frontend assets; web-ssr is the sole owner and server of `build/client`. nginx remains the ingress/coordination layer.

### Why A over B

- **A removes the dual-serving topology entirely; B preserves it.** Under B the hashes agree *because the build is shared*, but two images still each carry a copy of the assets and a future edit could re-introduce a second build or a copy skew. Under A there is one copy in one image; the failure mode is not "currently aligned," it is "cannot exist." This directly satisfies the product-owner intent ("assets must come from the SSR build, not a separate nginx static build").
- **A shrinks the reverse-proxy image** to a pure routing image (nginx conf + version + entrypoint layers; no assets layer).
- **Cost of A:** `/assets/*` gains one proxy hop (nginx → web-ssr) instead of nginx serving from local disk, and asset serving depends on web-ssr being up. Accepted: the catch-all `/` already proxies to web-ssr, so the app is already unavailable if web-ssr is down — assets are no more fragile than the HTML that references them. The `expires 1y; immutable` cache header is preserved at the nginx `/assets/` location, so browser/CDN caching is unchanged after first byte.

### Topology (amends ADR-034)

```
Browser ──► reverse-proxy (nginx)
              ├─ /api/*                         → auth-proxy        (unchanged, ADR-031 §2)
              ├─ /api/channels/:id/presentation-state → agent       (unchanged, ADR-015)
              ├─ /ui-state/*                    → auth-proxy        (unchanged, ADR-030 §SD1)
              ├─ /worker/*                      → agent             (unchanged)
              ├─ /health                        → auth-proxy        (unchanged)
              ├─ /_meta.json                    → nginx static      (reverse-proxy's OWN build identity)
              ├─ /assets/*                      → web-ssr  ◄── CHANGED: was nginx static, now proxied + immutable cache
              └─ /*  (catch-all)                → web-ssr  (SSR, unchanged)

web-ssr (Hono): serveStatic(build/client) for /assets/* ; RRv7 handler for everything else.
```

### Build pipeline (amends ADR-034 §"Build pipeline")

- **One `react-router build`** in `frontend/BUILD.bazel`, inside the `ssr_dist` genrule only. The `dist` genrule is deleted.
- The genrule runs `rm -rf build` **before** `react-router build`, so the output contains exactly one set of content-hashed assets (kills the stale-accumulation defect).
- `ssr_dist.tar` packages `build/server` (RRv7 SSR bundle, imported by `ssr.ts`) + `build/client` (the assets web-ssr now serves) + the esbuild'd `ssr.mjs`.
- The reverse-proxy `oci_image` drops the `assets_layer`; the `assets_layer` and `dist` genrules are removed.
- Target names are unchanged: `//frontend:image_tar` (reverse-proxy) and `//frontend:ssr_image_tar` (web-ssr) — the Makefile `load` recipe and `//:all_images` need no edits.

### `/_meta.json` (reverse-proxy build identity)

The reverse-proxy entrypoint writes its build identity to `/usr/share/nginx/html/_meta.json` (dc-1k8 / log-image-identity-on-startup AC2.2). This is the **reverse-proxy's own** identity and must not be proxied to web-ssr. An explicit `location = /_meta.json` serves it from the nginx static root (exact-match wins over the `/` catch-all). The nginx `root` directive is retained solely for this one file; the static SPA `index`/asset serving is removed.

## Consequences

### Positive

- The asset-hash 404 class is **structurally eliminated**: one build, one copy, one server. Hashes cannot diverge because there is no second set.
- Determinism: `rm -rf build` guarantees exactly one variant of each chunk per build; no cross-run accumulation, no stale disk-cache tars carrying ghost `Auth*-X.js` + `Auth*-Y.js` pairs.
- The reverse-proxy image is smaller and has a single responsibility (routing + its own identity).
- No change to ports, compose service names, or the five load-bearing nginx rules.

### Negative / accepted trade-offs

- `/assets/*` gains one proxy hop and now depends on web-ssr liveness. Accepted (see "Why A over B").
- web-ssr is now on the static-asset hot path, not just SSR. Mitigated by the `immutable` cache header at nginx and Hono `serveStatic`'s `ETag`/range support.

### Neutral

- ADR-034's single-React-tree, single-runtime, and route-level-migration decisions are untouched. This ADR only relocates *where assets are served from*.
- ADR-033's "one source body, two OCI images" holds: still two images, the bridging point is still the OCI tags in `frontend/BUILD.bazel`.

## Verification (artifact-level gate)

Because the merge-queue gate is backend-only, the fix is proven at the build-artifact level on a clean build:

1. `rm -rf frontend/build && bazel build //frontend:ssr_image_tar //frontend:image_tar`.
2. Extract `ssr_dist.tar`; collect (a) the `/assets/*.js` hashes the SSR output references (via `build/server`'s client manifest / rendered document) and (b) the `/assets/*` files actually present in `build/client`.
3. Assert: every referenced hash exists in the served set, and exactly one variant of each chunk exists.

Final **runtime** verification (`make up` → load app → no `/assets/*` 404) is performed by the overseer on the main checkout after merge.

## Reversibility

Symmetric with ADR-034's reversibility. To revert to dual-serving: re-add the `dist` genrule + `assets_layer`, restore the reverse-proxy `assets_layer` in `oci_image`, and revert the nginx `/assets/` location to static-serve. No data migration.

## References

- [ADR-034](adr-034-frontend-coexistence-via-rrv7-framework-mode.md) — amended here (build pipeline + asset-serving topology)
- [ADR-033](adr-033-source-tree-topology-separation.md) — one source body → two OCI images (preserved)
- [ADR-015](adr-015-headless-presentation-state-retrieval.md) — presentation-state nginx rule (preserved verbatim)
- dc-zdq / ddda6c7 — the env-alignment patch this ADR makes structurally unnecessary
