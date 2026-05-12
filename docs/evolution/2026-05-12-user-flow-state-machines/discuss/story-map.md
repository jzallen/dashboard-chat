# Story Map — `user-flow-state-machines`

> **Wave**: DISCUSS
> **Date**: 2026-05-11
> **Author**: Luna (nw-product-owner)

This map organizes the feature spatially: the **backbone** is the
sequence of user activities a user moves through across the product;
the **ribs** are the tasks/stories supporting each activity. The
**walking skeleton** is the thinnest end-to-end slice that proves the
state-machine pattern.

This wave deep-dives one column (`Login + Org Setup`). The other
columns are stubs sufficient to keep the horizontal backbone honest;
each gets its own DISCUSS pass before any of its stories can be
sliced for delivery.

---

## User

**Maya Chen** for the deep-dive column; **returning user with
existing org** for the cross-cutting `expired_token` row. Future
DISCUSS passes will add specific personas per column.

## Goal

**Every user flow's state is owned by a single server-driven
machine, projected to the UI, and assertable by a TS headless
harness.** Today, flow state is scattered across React component
state, TanStack Query keys, and ad-hoc test setup. The goal is
**one obvious file per flow**.

---

## Backbone

| Activity 1: Login + Org Setup *(deep-dive)* | Activity 2: Project + Session Mgmt *(stub)* | Activity 3: Dataset Upload *(stub)* | Activity 4: Table Preview *(stub)* | Activity 5: Transforms *(stub)* | Activity 6: View + Report *(stub)* | Activity 7: dbt Export *(stub)* |
|---|---|---|---|---|---|---|
| Sign in via WorkOS | Open project | Drag CSV or ask chat | Sort/filter table | Preview transform | Compose view/report | Trigger export |
| Set up org (first time) | Pick session | Watch upload + schema infer | Hide/reorder columns | Apply transform | Inspect SQL | Download zip |
| Recover from auth error | Resume prior session | See dataset bind to session | (scroll, scan) | Undo transform | (compose) | (read README) |
| Refresh expired token | Switch sessions | Confirm preview matches CSV | | Audit log | | |

### Walking Skeleton

The minimum end-to-end slice that proves the pattern:

* **A1 (Login + Org Setup)** — `WS-1`: Server-owned machine drives
  the happy-path login flow (`anonymous → authenticating →
  authenticated_no_org → creating_org → ready`). FE renders shell
  from machine projection. TS harness can assert reaching `ready`.
* **A2-A7 placeholders** — *stub stories only*. The walking skeleton
  in this feature is deliberately one-flow-deep; subsequent DISCUSS
  passes extend the skeleton to other columns. The pattern itself
  is the skeleton.

Why a one-column walking skeleton:

1. **Brownfield extension.** The pattern already exists for the
   dataset-staging slice (`DatasetLayerHarness`). We are not
   building "first flow + framework"; we are building "framework
   demonstrated by first flow, in a way the other flows can plug
   into."
2. **Risk localization.** The hardest decisions (state-machine
   library, where the layer lives, projection wire format) are
   exercised by exactly one flow, kept small. If the design needs
   to change, only J-001's code is rewritten.

---

## Release Slices (Login + Org Setup column only)

Each slice delivers a verifiable user behavior change AND moves an
outcome KPI. Slices ship in order; each is independently
demonstrable in a single session.

### Slice 1 — *Walking skeleton* — `Sign-in happy path is server-driven`

**Target outcome (JOB-002)**: O3 (minimize cost of changing a flow's
transition rules — one place, not N) — first observation of "one
file per flow" pattern.

**Stories**:

* **US-001**: A first-time user reaches the welcome page with their
  email pre-filled (states `anonymous → authenticating →
  authenticated_no_org`)
* **US-002**: A first-time user creates an org and lands in the app
  shell with org name and own name visible (states
  `authenticated_no_org → creating_org → ready`)

**Walking skeleton goes green when**: a TS harness test drives
US-001 + US-002 end-to-end, asserting reaching `ready` with
matching `org.id` claim in JWT and matching `org.name` in machine
state.

**Demo**: 5 minutes, in browser. Maya signs in fresh, types an
org name, lands in the shell. Same flow re-played by the TS harness
in the test output.

---

### Slice 2 — `Error recovery is honest and threaded`

**Target outcome (JOB-002)**: O4 (minimize time-to-recovery when a
flow hits an unexpected state — visible error UI + same error from
the harness).

**Stories**:

* **US-003**: A transient JWKS or callback failure shows the user
  an empathetic recoverable-error UI with the correlation id
* **US-004**: The TS harness can drive every J-001 transition
  end-to-end (force any transient failure tag; assert state; assert
  the JWT carries the org claim)

**Demo**: in browser + in test runner. Trigger JWKS reset → UI
shows the recoverable-error mockup with correlation id. Same id
appears in the harness assertion output.

---

### Slice 3 — `Expired token freezes mutations and replays in flight`

**Target outcome (JOB-002)**: O2 (minimize the divergence between
what the UI shows and what a headless test asserts) — the
cross-flow freezing semantics are server-owned, so the harness
sees the same freeze the user does.

**Stories**:

* **US-005**: A user with an in-flight request whose token expires
  sees a non-blocking refresh banner; the request replays silently
  after silent re-auth succeeds. On silent-re-auth FAILURE the
  surfaced recoverable-error carries the ORIGINAL request's
  correlation id (the silent-re-auth-failure path is scenario 2
  inside US-005, not a separate story — the two paths share the
  same code and the same correlation-id-threading contract).

**Demo**: browser + harness. Force a token expiry mid-turn. Banner
flicks; chat resumes after ~1 second. Harness assertion path: force
silent-re-auth-failure; assert correlation-id chain.

---

## Placeholder columns (other flows)

Each placeholder column has a single stub story that does not enter
this wave's DoR validation. It exists to (a) make the backbone
visible, (b) keep the priority rationale honest, (c) seed the next
DISCUSS pass.

### A2 — Project + Session Management

* **US-101** *(stub)*: Server-owned `project-and-session-mgmt`
  machine, mirroring J-001's shape. Entry contract: reads
  `session.current` from J-001's `ready` state. Next DISCUSS pass.

### A3 — Dataset Upload

* **US-102** *(stub)*: Server-owned `dataset-upload` machine
  covering both chat-driven and direct-upload paths. Existing
  `UploadsApi` becomes the machine's primary effect. Next DISCUSS pass.

### A4 — Table Preview

* **US-103** *(stub)*: Promote ADR-015's directive log to a
  `table-preview` machine. This is the smallest delta from the
  existing implementation. Next DISCUSS pass.

### A5 — Transforms

* **US-104** *(stub)*: Formalize the existing transforms API +
  replay infrastructure as a `transforms` machine. The
  preview-vs-apply sub-state is the only new shape needed. Next
  DISCUSS pass.

### A6 — View + Report

* **US-105** *(stub)*: Server-owned `view-and-report-compose`
  machine. Weakest existing harness coverage; dive will be the
  most substantive of the remaining flows. Next DISCUSS pass.

### A7 — dbt Export

* **US-106** *(stub)*: Wrap the existing ADR-019/ADR-024 export
  machinery in a thin FE-facing machine. Smallest dive remaining.
  Next DISCUSS pass.

---

## Priority Rationale

Slice priority order is **outcome-driven and dependency-aware**, not
effort-driven.

| Order | Slice | Why this order |
|-------|-------|----------------|
| 1 | Slice 1 — Sign-in happy path is server-driven | This is the walking skeleton. It proves the pattern. Every subsequent slice (this feature OR the next DISCUSS passes for other flows) depends on the framework being in place. |
| 2 | Slice 2 — Error recovery is honest and threaded | This is the slice where the pattern's value becomes **legible** to the user (correlation id) AND to the test author (forced-failure surface). Without Slice 2, the framework feels like infra; with it, the framework feels like product. |
| 3 | Slice 3 — Expired token freezes mutations and replays in flight | This slice exercises the **cross-flow** semantics (one machine freezes another). It is the architectural payoff and the riskiest carpaccio. It also resolves a recurring real-world bug class. |
| 4-9 | A2-A7 stub columns | Deferred to subsequent DISCUSS passes. None ship until the slice's column has its own deep-dive. The order across A2-A7 will be set by which flow has the next highest debugging cost — likely A2 (sessions) given recent friction around per-user-per-channel state, but that is a DISCUSS-time call when the time comes. |

**Riskiest-assumption-first** ordering would have promoted Slice 3
to slice 1. We did not, because:

* Slice 1 is the only slice that can be demoed without the
  framework already existing. Slice 3 presupposes slices 1 and 2.
* Slice 3's riskiest assumption (machines can freeze other
  machines) is partially mitigated by ADR-015's existing pattern
  (the directive log already conveys "the worker tells the FE
  something is happening"). The novelty in Slice 3 is bidirectional
  state, not the existence of cross-FE state.

---

## Scope Assessment: PASS — 5 stories in 3 carpaccio slices for the deep-dive column, 6 stub placeholders for catalogued columns, estimated 4-6 days for slices 1-3 (excluding framework build, which is a DESIGN concern).

* Stories per slice: 2 (within 3-7 range)
* Bounded contexts touched per slice: 2 (FE shell + worker projection
  surface) — well under the 3-context oversize signal
* Walking-skeleton integration points: 4 (auth-proxy callback,
  backend JWKS, worker SSE, FE projection consumer) — at the upper
  end of "right-sized," but no individual point is novel; each
  already exists in the codebase
* Independent user outcomes: 3 (sign-in works, errors are humane,
  token refresh is invisible) — each is a distinct verifiable
  behavior change
* Other columns (A2-A7): deliberately deferred to future DISCUSS
  passes; this feature does NOT attempt to ship all 7 columns in
  one wave (would oversize at 14+ stories)

The orchestrator-imposed tiered-depth strategy is what keeps the
scope right-sized. Deferring A2-A7 is not a scope cut — it is a
**slice-by-flow** decomposition, where each flow is its own DISCUSS
+ DESIGN + DELIVER cycle.
