# Open Questions — SSR ui-server Gateway

> DISCUSS-wave capture. These are the points the brainstorm
> ([`idea-capture.md`](./idea-capture.md)) left genuinely undecided. They are
> recorded as questions, NOT answered here — answering them is DESIGN-wave work
> for the architect planning the first slice. No options are pre-selected.

---

## OQ1 — How does the SSE relay survive the hops un-buffered?

Agent chat is a POST-body `ReadableStream` SSE; ui-state is `EventSource` SSE.
Piping these THROUGH the node server is the hard part: backpressure, long-lived
connections, and memory must all be handled without buffering. The brainstorm
flags this as real work and the reason SSE migrates LAST — but it does not decide
*how* the relay preserves streaming semantics across `client -> auth-proxy ->
ssr -> agent`.

**Why it matters:** this is exactly the assistant-transform path that is the
near-term priority, and it concentrates the hot-path risk.

---

## OQ2 — Is ui-state's EventSource collapsed into the ui-server too, or does it stay direct?

The brainstorm says ui-state `EventSource` is relayed "likewise IF full collapse
is wanted" — i.e. whether ui-state is folded behind the ui-server or remains a direct
origin is explicitly optional and undecided.

**Why it matters:** it changes the scope of Phase 3/4 and whether "single client
origin" (J1) is literal or near-literal.

---

## OQ3 — How is on-behalf-of M2M scoping bounded so the ui-server does not over-grant?

The auth on-behalf-of logic moves into the ui-server; the brainstorm states
"impersonation must be scoped correctly (the ui-server must not over-grant)" but does
not decide the scoping model, audience/permission constraints, or how a ui-server token
acting for user X is prevented from exceeding user X's authority.

**Why it matters:** this is the core of the security win (J2); getting the
scoping wrong inverts it into a security risk.

---

## OQ4 — What is the acceptable latency budget for the double hop?

`client -> auth-proxy -> ssr -> backend` adds per-call latency, "partly bought
back by aggregation." The brainstorm does not set a target or threshold for what
"acceptable" means, nor which calls must stay under it.

**Why it matters:** it constrains which reads are worth moving server-side and
whether aggregation actually offsets the hop for a given route.

---

## OQ5 — Does auth-proxy stay the edge, or is it folded into the ui-server?

The brainstorm consistently describes auth-proxy as the edge (validates session,
injects `X-User-Id`) AND the ui-server as the downstream broker, but does not decide
whether auth-proxy remains a separate edge service long-term or is eventually
folded into web-ssr.

**Why it matters:** it shapes the end-state topology (Phase 4) and where session
validation vs. service-credential brokering live.

---

## OQ6 — How is a transform reflection's per-node preview hydrate handled under the ui-server?

A backend-contract finding: `GET /api/datasets` returns NO preview rows;
transform-aware preview only exists on
`GET /api/datasets/{id}?include_preview=true`. So a transform reflection needs a
per-node preview hydrate, not just a list re-fetch. The brainstorm records this
constraint but, consistent with keeping reactive reads client-side, does not
decide whether/how the ui-server participates in that hydrate.

**Why it matters:** it sits at the boundary between "reactive reads stay
client-side" (which-data-goes-where) and the live assistant-transform priority.

---

## OQ7 — What is the per-route flip mechanism: route-by-route code or a feature flag?

Migration safety relies on per-route / per-endpoint flips so any slice rolls back
independently. The brainstorm offers BOTH "route-by-route or a feature flag" as
the mechanism without choosing.

**Why it matters:** it affects how a rollback is performed and whether flips are
deploy-time or runtime.

---

## OQ8 — Where does the ui-server hold and refresh its service credentials?

The ui-server "holds service creds" and mints M2M (auth-proxy already mints
`client_credentials` at `POST /api/auth/token`). The brainstorm does not decide
how web-ssr stores those creds, how tokens are cached/refreshed, or the failure
behavior when minting fails.

**Why it matters:** it is the operational backbone of every ui-server downstream call
and a single point of failure on the new hot path.

---

## Non-questions (explicitly decided in the brainstorm — recorded to prevent re-litigation)

These are NOT open; the brainstorm settled them and DESIGN should treat them as
inputs, not choices:

> **Superseded (2026-06-25).** The first non-question below ("reactive reads stay
> in the client `DataCatalog`") is superseded by
> [ADR-034 §"Amendment (2026-06-25)"](../../../decisions/adr-034-frontend-coexistence-via-rrv7-framework-mode.md):
> derivation stays server-side in the loader and SSE is a revalidation *trigger*,
> with no client-side graph state. Preserved as captured; not rewritten.

- **Reactive reads stay in the client `DataCatalog`; only cold/initial/
  static-after-load reads move to server loaders.** (The "does it change
  reactively after the route loads?" test.)
- **SSE migrates LAST** (Phase 3), because the direct path works and the risk
  concentrates there.
- **The security tightening is banked at the END** (Phase 4), after every path
  is proven.
- **Phase 0 is the shared prerequisite** for both the ui-server and the M2M-clean live
  assistant-transform skeleton.
- **A slice is a "repoint," not a "rewrite,"** because of the `DataCatalog`
  `dataSource` indirection.
