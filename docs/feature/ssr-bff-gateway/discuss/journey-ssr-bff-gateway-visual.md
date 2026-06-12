# Architecture Journey Sketch — SSR BFF Gateway

> DISCUSS-wave capture. A short journey sketch of the **strangler-fig
> progression Phase 0 → 4** from [`idea-capture.md`](./idea-capture.md). This is
> NOT a design: no endpoint design, no sequence diagrams, no state machines. It
> traces the *migration arc* and the *confidence arc* of the engineer driving
> it, so the order and the safety mechanics are preserved.

---

## Today (starting state)

```
          ┌──────────── /api/*  ────────────► backend
browser ──┤ /worker/*  ─────────────────────► agent  (SSE)
  (ui/)   └──────────── /ui-state/* ─────────► ui-state (EventSource SSE)
              via reverse-proxy (nginx) + auth-proxy edge
```

- Client talks to MANY surfaces, multiplexed through the edge.
- `web-ssr` streams the SPA shell only; real data arrives client-side after
  hydration via `clientLoader` priming the `DataCatalog`.
- Downstream services trust browser-forwarded JWTs (the agent forwards the
  user's JWT — identity-attribution TODO).

## Target (end state)

```
browser ── auth-proxy (validate session, inject X-User-Id) ── web-ssr (BFF)
                                                                 │ M2M + on-behalf-of
                                                                 ├──► backend
                                                                 ├──► agent
                                                                 └──► ui-state
```

- Client knows ONE origin (its SSR server). The BFF fans out with service creds.
- Downstream services trust ONLY the BFF.

---

## The progression — step by step

### Step 0 — Stand up the seam, move nothing  *(Phase 0)*

- **What moves:** nothing functional. One resource route (e.g. `/bff/orgs/me`)
  proves `web-ssr` can authenticate ONE backend read server-side via M2M +
  on-behalf-of. Direct path still hits `/api/orgs/me`.
- **Gating question answered:** "can web-ssr authenticate a backend read
  server-side?"
- **Why first:** zero blast radius, and it is the SHARED prerequisite for the
  live assistant-transform skeleton (same capability).
- **Engineer confidence:** *uncertain → grounded.* The riskiest unknown is
  retired cheaply. Do not proceed until green.

### Step 1 — Cold reads to server loaders  *(Phase 1)*

- **What moves:** org-global + initial lineage bundle reads, promoted from
  `clientLoader` to server loaders fetching via the BFF; the 4 lineage calls
  aggregate into 1. The `DataCatalog` stays, now hydrated from loader data on
  first paint.
- **What stays put:** live/reflection reads remain client-side.
- **Order:** one route at a time — `project-layout` first (most-trafficked),
  prove, then the rest.
- **Engineer confidence:** *grounded → encouraged.* First user-visible win (real
  data on first paint; waterfall collapsed), still fully reversible.

### Step 2 — Mutations behind actions/resource routes  *(Phase 2)*

- **What moves:** optimistic write-throughs (audit toggle first, then
  transforms) flip from `client->auth-proxy->backend` to RRv7 actions the BFF
  executes via M2M-on-behalf-of. Optimistic UI stays in the catalog; only the
  network TARGET changes.
- **What it cashes in:** the identity-attribution fix.
- **Engineer confidence:** *encouraged → committed.* Writes now flow through the
  owned seam; the security debt starts being paid down.

### Step 3 — Relay the streams  *(Phase 3, hard, last)*

- **What moves:** a resource route proxies the agent SSE (pipe the
  `ReadableStream`, prove NO buffering through hops), then point the chat client
  at the BFF route instead of `/worker/chat`. ui-state `EventSource` likewise IF
  full collapse is wanted.
- **Why last:** the direct path works, and this is where the hot-path risk
  concentrates (backpressure, long-lived connections, memory).
- **Engineer confidence:** *committed → tested under load.* The hardest path,
  attempted only once everything cheaper is proven.

### Step 4 — Collapse origins + tighten downstream  *(Phase 4)*

- **What moves:** strip the client's knowledge of `/api`, `/worker`,
  `/ui-state`; nginx simplifies to static + everything->ssr; downstream services
  drop browser-JWT trust to accept ONLY M2M from the BFF.
- **Why last:** the security win is BANKED at the END, after every path is
  proven.
- **Engineer confidence:** *tested → consolidated.* Single origin, single trust
  boundary, every step earned.

---

## The confidence arc (preserved as a property, not a metric)

```
uncertain → grounded → encouraged → committed → tested-under-load → consolidated
   P0          P0          P1            P2             P3                P4
```

The arc only ever moves up because **the old direct path stays alive** until each
BFF slice is proven in the live stack, and **any slice rolls back
independently** (per-route / per-endpoint flips). The `DataCatalog` `dataSource`
indirection is the harness that makes each step a small repoint, not a rewrite.

---

## Shared artifact across the journey

The single artifact that every step passes forward is the **`DataCatalog`
`dataSource` seam**. Its single source of truth is `ui/`'s catalog layer
(`fixtureSource` / `metadataApiSource` today; a BFF source added beneath it). No
component changes as the plumbing moves — that invariant is what makes the
journey a strangler fig rather than a cutover.
