# JTBD Job Stories — SSR ui-server Gateway

> DISCUSS-wave capture. Job stories derived faithfully from the brainstorm in
> [`idea-capture.md`](./idea-capture.md). No design decisions; these name the
> *jobs* the SSR-ui-server-gateway idea exists to serve. Job-story form:
> **When [situation], I want to [motivation], so I can [outcome].**
>
> Note: the "users" here are mixed — some jobs serve the **client/UI engineer**,
> some serve **downstream-service / security owners**, and some serve the
> **end user** of `ui/`. Each story names whose job it is.

---

## J1 — Integrate the client against one stable surface instead of three

**Whose job:** the client / `ui/` engineer.

**When** I'm wiring `ui/` to its data, mutations, and streams,
**I want to** talk to a single origin (its own SSR server) instead of
multiplexing `/api`, `/worker`, and `/ui-state` through the edge,
**so I can** reason about one integration contract and one failure surface
rather than three.

- **Functional:** collapse the client's known surface to "the SSR server," which
  fans out to backend/agent/ui-state.
- **Emotional:** confidence from a single, owned seam instead of cross-service
  coupling leaking into the browser.
- **Social:** present a clean ui-server boundary that reads as idiomatic RRv7, not a
  bespoke proxy tangle.

*Realism note from brainstorm: this is the standard ui-server shape (RRv7
loaders/actions + resource routes; same as Next route handlers / SvelteKit
endpoints). The collapse is the END state (Phase 4), reached by strangler-fig,
not big-bang.*

---

## J2 — Let downstream services trust one caller, not browser-forwarded JWTs

**Whose job:** the downstream-service / security owner.

**When** I'm deciding who my backend/agent/ui-state services should trust,
**I want to** accept calls from ONE service identity (the ui-server) acting
on-behalf-of a user, instead of trusting JWTs forwarded by the browser,
**so I can** resolve the identity-attribution TODO
(`auth-proxy/lib/m2m.ts:29-38`) and shrink the trust surface to a single caller.

- **Functional:** auth-proxy validates the session + injects `X-User-Id` at the
  edge; the ui-server holds service creds, mints M2M, and calls downstream as itself
  for user X.
- **Emotional:** relief at one auditable trust boundary instead of many
  browser-originating tokens.
- **Social:** a security posture that reads as deliberate (service identity +
  on-behalf-of), not "we forward whatever the browser sends."

*Realism note from brainstorm: the security win is BANKED LAST (Phase 4), after
every path is proven; the on-behalf-of scoping must not over-grant (open
question).*

---

## J3 — Show real data on first paint instead of an empty shell

**Whose job:** the end user of `ui/` (served via the engineer's work).

**When** I navigate to a project / lineage view,
**I want to** see real data on the first render,
**so I can** start working immediately instead of watching a shell hydrate and
then fetch.

- **Functional:** promote cold/initial reads (org-global, initial lineage
  bundle) to server loaders fetching via the ui-server; SSR delivers data, not just a
  shell.
- **Emotional:** the app feels instant and substantial on arrival.
- **Social:** the product looks production-grade, not like a spinner farm.

*Realism note from brainstorm: only COLD / static-after-load reads move server-
side. Reactive reads (live assistant-transform reflection) stay client-side —
moving them to the server makes reflection WORSE. The test: "does this read
change reactively after the route loads?" No → server loader; Yes → client
catalog.*

---

## J4 — Collapse the 4-fetch lineage waterfall into one response

**Whose job:** the client / `ui/` engineer (felt by the end user as speed).

**When** the lineage bundle needs sources + datasets + views + reports,
**I want to** aggregate those four calls server-side into one client response,
**so I can** replace four browser round-trips with a single one.

- **Functional:** a ui-server loader fans out `/api/sources`, `/api/datasets`,
  `/api/projects/{pid}/views`, `/api/projects/{pid}/reports` and returns one
  bundle.
- **Emotional:** satisfaction at removing a visible waterfall.
- **Social:** demonstrably fewer round-trips, partly buying back the double-hop
  latency cost.

*Realism note from brainstorm: aggregation partly offsets the extra hop the ui-server
introduces; a transform reflection still needs a per-node preview hydrate
(`GET /api/datasets/{id}?include_preview=true`), not just a list re-fetch.*

---

## J5 — Migrate one read/mutation/stream at a time, and roll back any slice

**Whose job:** the client / `ui/` engineer (delivery safety).

**When** I'm moving the plumbing from direct origins onto the ui-server,
**I want to** flip one route/endpoint at a time with the old direct path still
alive, each slice independently shippable and reversible,
**so I can** avoid a big-bang cutover and roll back any single slice without
touching the others.

- **Functional:** per-route / per-endpoint flips (route-by-route or feature
  flag); the `DataCatalog` `dataSource` indirection means a slice is "repoint
  this read at a ui-server route," not "rewrite a component."
- **Emotional:** safety — every step is provable in the live stack before the
  next.
- **Social:** matches the merge-queue carpaccio cadence; reads as disciplined
  incrementalism.

*Realism note from brainstorm: the `dataSource` abstraction is the strangler-fig
harness; components read from `catalog` and never change as plumbing moves
underneath.*

---

## J6 — De-risk the ui-server and unblock the live assistant-transform with one move

**Whose job:** the client / `ui/` engineer (sequencing leverage).

**When** I'm choosing where to start,
**I want to** stand up the ui-server seam for ONE endpoint (Phase 0) that proves
"web-ssr authenticates a backend read server-side,"
**so I can** simultaneously de-risk the whole ui-server direction AND unblock the
M2M-clean live-transform skeleton, which needs the same capability.

- **Functional:** one resource route (e.g. `/ui-server/orgs/me`) via M2M +
  on-behalf-of, zero blast radius; the direct path still hits `/api/orgs/me`.
- **Emotional:** momentum from a single small move that pays down two debts.
- **Social:** a well-chosen first slice that proves the gating question cheaply.

*Realism note from brainstorm: Phase 0 is explicitly the shared prerequisite for
both the ui-server and the live assistant-transform work; do not proceed past it until
green.*

---

## Job → outcome map (capture-only, non-binding)

| Job | Capturable outcome | Phase it first appears |
|-----|--------------------|------------------------|
| J1 | Single client origin | Phase 4 (end state) |
| J2 | Downstream trusts one M2M caller | Phase 2 cashes in, Phase 4 banks |
| J3 | Real data on first paint | Phase 1 |
| J4 | 4 lineage fetches → 1 | Phase 1 |
| J5 | Slice-by-slice, rollback-safe migration | Phases 0–4 (mechanic) |
| J6 | Phase-0 seam de-risks + unblocks transforms | Phase 0 |
