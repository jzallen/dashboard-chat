# Idea Capture — SSR BFF Gateway

> **DISCUSS-wave capture, CAPTURE-ONLY.** This document preserves a brainstormed
> architecture direction faithfully so it is not lost. It is **not** a design.
> No ADRs, no C4, no API/endpoint/state-machine design, no sequence diagrams,
> no technology selection beyond what the brainstorm already states. Genuinely
> undecided points are recorded as open questions (see
> [`open-questions.md`](./open-questions.md)), not invented answers. A separate
> architect plans the first slice.

---

## Background context — how we got here

- The project is replacing the OLD frontend app `frontend/` (React + TanStack
  Query) with a NEW app `ui/` (React Router v7 / RRv7 framework mode, SSR via a
  Hono `web-ssr` container; reverse-proxy nginx serves static + routes `/api/*`,
  `/worker/*`, `/ui-state/*`; auth-proxy is the auth edge: JWT verification, M2M
  mint, identity-header injection, multi-upstream routing). `frontend/` is
  nearly ready to retire.

- A prior investigation established the **assistant rails are LIVE end-to-end
  server-side**: `agent/` (Hono + SSE, Groq tool-calling) already POSTs
  `/api/datasets/{id}/transforms` and emits `transform_applied`; transforms are
  persisted (backend `create_transforms` + `transform_sync_event`). But `ui/`'s
  assistant is currently **MOCKED** (a `setTimeout` script in
  `ui/app/components/Chat/Chat.tsx`).

- A second finding: **`ui/` does NOT use TanStack Query.** Its data layer is the
  client-side `DataCatalog` (`useSyncExternalStore`) with `revalidateScoped` +
  optimistic write-through (the audit-toggle precedent). RRv7 routes use
  `clientLoader` (CLIENT only) to PRIME the catalog on navigation (`root.tsx`,
  `app-shell.tsx`, `project-layout.tsx`); SSR today is shell-only
  (`entry.server` streams the SPA shell; real data arrives client-side after
  hydration). So the `DataCatalog` is already the TanStack-equivalent, and the
  catalog's `dataSource` abstraction (`fixtureSource` vs `metadataApiSource`) is
  the **seam where transport can be swapped**.

- A backend contract finding: `GET /api/datasets` (the sparse list the lineage
  bundle reads) returns NO preview rows; transform-aware preview only exists on
  `GET /api/datasets/{id}?include_preview=true` (runs `query_preview_rows` =
  staging SQL WITH transforms against parquet). So a transform reflection needs a
  **per-node preview hydrate**, not just a list re-fetch.

---

## The core idea — SSR server as the single client integration point (a BFF)

- What is most interesting about the SSR build: give the client **ONE point of
  integration** — its own RRv7 SSR node server. All communication becomes:

  ```
  client -> auth-proxy -> SSR node server -> other services via M2M
  ```

- Today the client talks to MANY surfaces (`/api` backend, `/worker` agent,
  `/ui-state`) multiplexed through the edge. The proposal **collapses the
  client's surface to just "the SSR server,"** which then fans out to
  backend/agent/ui-state using a **service identity (M2M)** carrying the user
  **on-behalf-of**.

---

## Feasibility verdict (as stated)

- **Feasible and idiomatic** — this is the **Backend-for-Frontend (BFF)
  pattern**, the standard RRv7 shape: loaders/actions for route data, **RESOURCE
  ROUTES** for arbitrary client-callable endpoints. Same shape as Next route
  handlers / SvelteKit endpoints. The client knows one origin; the server
  brokers downstream with service creds.

- It resolves two existing pain points:

  1. **The identity-attribution TODO** (`auth-proxy/lib/m2m.ts:29-38` — the agent
     currently forwards the USER's JWT). The BFF is the natural home for
     "service identity + on-behalf-of": auth-proxy validates the session and
     injects `X-User-Id` at the edge; the SSR server holds service creds, mints
     M2M (auth-proxy already mints `client_credentials` at `POST
     /api/auth/token`), and calls downstream as the BFF acting for user X.
     Downstream services stop trusting browser-forwarded JWTs and trust ONE
     caller.

  2. **The 4-fetch lineage waterfall**: `fetchLineageBundle` currently makes the
     BROWSER fire `/api/sources`, `/api/datasets`, `/api/projects/{pid}/views`,
     `/api/projects/{pid}/reports` as four client round-trips. A BFF loader
     **AGGREGATES** those server-side into one client response.

---

## Honest costs / risks (preserved — not resolved here)

- The SSR node server moves onto the **HOT PATH for everything** (all data +
  mutations), not just navigation; its availability/latency/scaling now gate
  everything. Today static + some `/api` can bypass it.

- **SSE relay is the hard part**: agent chat is POST-body `ReadableStream` SSE;
  ui-state is `EventSource` SSE. Piping those THROUGH the node server without
  buffering (backpressure, long-lived connections, memory) is real work — and it
  is exactly the assistant-transform path that is the near-term priority. Hence
  **SSE migrates LAST.**

- A **double hop** (client -> auth-proxy -> ssr -> backend) adds per-call
  latency, partly bought back by aggregation.

- **Auth on-behalf-of logic moves into the BFF** — impersonation must be scoped
  correctly (the BFF must not over-grant).

---

## Progressive migration — strangler fig

- **Key enabler:** the `DataCatalog` `dataSource` abstraction already exists, so
  you migrate the plumbing UNDER the catalog one slice at a time; components read
  from `catalog` and never change. That indirection is the strangler-fig
  harness.

### Phase 0 — stand up the BFF seam, move nothing

Give `web-ssr` a server-side HTTP client that calls ONE downstream endpoint via
M2M + on-behalf-of header, behind a single resource route (e.g.
`/bff/orgs/me`). Existing client path still hits `/api/orgs/me` directly. This
answers the gating question **"can web-ssr authenticate a backend read
server-side?"** for one endpoint, zero blast radius. Do not proceed until green.

> **NOTE:** Phase 0 is also the prerequisite for the live assistant-transform
> work — both need "web-ssr authenticates a backend call server-side" — so doing
> Phase 0 de-risks the BFF AND unblocks the M2M-clean live-transform skeleton
> with the same work.

### Phase 1 — move COLD/INITIAL reads to SERVER loaders

The SSR-worthy, static-after-load set: org-global, initial lineage bundle.
Promote the relevant `clientLoader`s to server loaders fetching via the BFF,
**aggregating the 4 lineage calls into 1**. The `DataCatalog` stays; it is now
hydrated from loader data on first paint instead of client-fetching.
Live/reflection stays client-side. One route at a time (`project-layout` first,
most-trafficked), prove, then the rest.

### Phase 2 — move MUTATIONS behind actions/resource routes

The optimistic write-throughs (audit toggle first, then transforms) flip from
`client->auth-proxy->backend` to RRv7 actions the BFF executes via
M2M-on-behalf-of. Optimistic UI stays in the catalog; only the network TARGET
changes. **This cashes in the identity-attribution fix.**

### Phase 3 — relay the STREAMS (hard, last)

A resource route proxies the agent SSE (pipe the `ReadableStream`, prove no
buffering through hops), then point the chat client at the BFF route instead of
`/worker/chat`. ui-state `EventSource` likewise if full collapse is wanted. Last
because the direct path works and this is where the hot-path risk concentrates.

### Phase 4 — collapse remaining direct origins + tighten downstream

Once reads/mutations/streams all route through the BFF, strip the client's
knowledge of `/api`, `/worker`, `/ui-state`; nginx simplifies to static +
everything->ssr; downstream services drop browser-JWT trust to accept ONLY M2M
from the BFF — **the security win banked at the END, after every path is
proven.**

---

## Migration safety mechanics

- **Per-route / per-endpoint flips** (route-by-route or a feature flag) so any
  slice rolls back independently.
- **Old direct path stays alive** until each BFF slice is proven in the live
  stack.
- **Each slice independently shippable (carpaccio)**, matching the merge-queue
  cadence.
- A slice = **"repoint this read at a BFF route,"** not "rewrite a component,"
  because of the catalog `dataSource` indirection.

---

## Which-data-goes-where principle

> This came from the prior TanStack-vs-loaders discussion and frames Phase 1.

- Server loaders replicate the request -> action -> auto-revalidate loop and add
  native SSR, but do NOT replicate TanStack's warm entity-keyed **CROSS-ROUTE
  cache**, granular by-key invalidation, or staleness/background refetch — those
  remain the `DataCatalog`'s job.

- **Decisive:** for the LIVE assistant-transform reflection, moving the fetch to
  the SERVER makes reflection WORSE (a round-trip to the SSR server per event,
  coarse re-run of all active loaders) vs a cheap client revalidate. So reactive
  reads stay in the client catalog; only cold/initial/static-after-load reads
  move to server loaders.

- **The test for any read:** "does it change reactively after the route loads?"
  - **No** -> server loader is a clean win (SSR + auth server-side).
  - **Yes** -> client catalog.
