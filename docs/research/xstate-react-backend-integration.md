# Research: Server-side XState (v5) Actor Systems ↔ React Frontend Integration — and the ui-state HTTP API Surface

**Date**: 2026-05-29 | **Researcher**: nw-researcher (Nova) | **Wave**: RESEARCH | **Status**: COMPLETE | **Confidence**: High | **Web sources**: 11 (8 primary, 3 secondary) + 5 in-repo ADRs + 3 source files

## Question + TL;DR Verdict

> **Working hypothesis under evaluation:** "There should be a single user-parameterized endpoint for all of chat-app that the frontend sends events to, and the machine returns the updated state."

**Verdict: REFINE — the hypothesis is directionally correct and, in its mechanism, ALREADY LIVE; its genuinely-open part is narrower than stated.** The established evidence confirms the *shape* the hypothesis names — a single user-parameterized write endpoint where the FE sends an event and the machine returns updated state — is the idiomatic way to expose a server-resident XState v5 actor: XState ships only local primitives (`send` = event-in, `getSnapshot`/`getPersistedSnapshot` = state-out, `subscribe` = push) and **no built-in network transport** (Stately docs, Finding 1/3), so the developer bridges them over HTTP exactly as this codebase does. The codebase ALREADY implements the hard parts: ONE actor per principal, event-in via `POST /event`, **derived-projection-out (not raw snapshot)**, header-injected identity derived server-side, and SSE for externally-changing state (ADR-027/028/030/040/044; verified in `router.ts`, `derive-projection.ts`, `snapshot.ts`). Two refinements the evidence forces: (a) "returns the updated state" must mean the **stable derived projection**, never `getPersistedSnapshot()` — the raw snapshot is version-coupled and would break the frozen wire (Findings 2/5); and (b) the actual open decision is not "should there be a single write endpoint" (writes already converge on one actor) but **whether to collapse the THREE per-machine READ projections into ONE composite chat-app surface** — which is precisely ADR-044 §5 Open Question #3, a sound-but-optional FE+auth-proxy story whose payoff is FE/ops simplification (fewer SSE streams under the HTTP/1.1 6-connection cap), not a correctness fix.

## Executive Summary

A server-side XState v5 actor system has no native way to project itself to a React frontend: XState ships only in-process primitives (`createActor`/`send`/`getSnapshot`/`getPersistedSnapshot`/`subscribe`) and the official docs are explicitly silent on network boundaries; `@xstate/react` runs actors *client-side* and cannot observe a remote actor. The idiomatic bridge is therefore application-level: forward events to the server actor over HTTP (`POST` → `actor.send`), return a **stable derived projection** of the actor's state (not the raw, version-coupled persisted snapshot), and push externally-driven state changes (agent co-authoring, background transitions) over SSE — request/response for the user's own events, one-way SSE for everything else, WebSocket only if bidirectional is genuinely needed.

This codebase's ui-state tier already implements that bridge faithfully across ADR-027/028/030/040/044: one ChatApp actor per principal, header-derived identity (no client-supplied flow_id), a byte-stable `FlowProjection` derived through a contract-tested mapper, hybrid snapshot-as-state-of-record persistence with a settled-state-only guard that defuses XState's "invocations restart on rehydrate" hazard, and an SSE projection stream. The working hypothesis ("a single user-parameterized endpoint the FE sends events to, machine returns updated state") is thus confirmed in mechanism and already live on the WRITE side — all writes converge on one per-principal actor regardless of which of the five wire mounts they hit. The only genuinely-open question is whether to collapse the THREE per-machine READ projections into one composite chat-app projection — exactly ADR-044 §5 OQ#3 — a sound but optional FE+auth-proxy story whose benefit is simplification (notably fewer SSE streams under MDN's documented HTTP/1.1 6-connection cap), not correctness.

Confidence is High: the load-bearing claims rest on primary sources (Stately official docs, MDN, IETF RFC 9110) cross-referenced against the repository's own source and ADRs. The one Medium-confidence area is the *prevalence* of "single POST /event" as a community-canonical shape (no single source prescribes endpoint count — it is an application choice), and the Idempotency-Key draft (standards-track, not an RFC; the fetched revision was expired).

## Research Methodology

**Search Strategy**: Primary-source-first. Fetched official Stately docs (actors, persistence, @xstate/react, transitions, inspection, v5 blog), MDN (SSE), IETF (RFC 9110, Idempotency-Key draft), React (useOptimistic), TanStack Query (optimistic updates), and corroborated the "actor on the server" pattern via targeted web search + the statelyai/xstate GitHub discussions. Verified every codebase grounding note by reading the actual files (`router.ts`, `derive-projection.ts`, `snapshot.ts`, `chatapp-snapshot-store.ts`, `README.md`) and the five ADRs (027/028/030/040/044) before citing them.
**Source Selection**: official (stately.ai, react.dev, MDN, IETF), industry leaders (martinfowler), GitHub (statelyai/xstate). Maintainer = David Khourshid (@davidkpiano).
**Quality Standards**: cross-reference every major claim with ≥2 sources (3+ ideal); primary > secondary; uncorroborated marked SPECULATIVE; access date + reputation per source.

## Findings — Patterns

### Finding 1: XState v5 actors are an in-process actor model; the official docs are silent on network boundaries
**Evidence**: The official actor docs frame actors via `createActor(actorLogic, options?)`, `actor.send(event)`, `actor.getSnapshot()` ("read an actor's snapshot synchronously"), and `actor.subscribe(observer)`. Actors "communicate with other actors by sending and receiving events asynchronously" and "process one message at a time" via an internal mailbox. Critically: the actors documentation contains **no mention of server-side execution or network boundaries** — all examples are local, in-process actor systems.
**Source (PRIMARY)**: [Stately — Actors](https://stately.ai/docs/actors) — Accessed 2026-05-29. Reputation: High (1.0, official XState docs).
**Confidence**: High (single authoritative/primary source; this is the canonical definition).
**Analysis**: This is decisive for the question. XState does **not** ship a built-in network transport. "Run the machine on the server and send it events over HTTP/WS" is an *application-level* pattern the developer must build — XState gives you `send` (event-in), `getSnapshot` (state-out), and `subscribe` (push) as the local primitives you bridge across the wire. The codebase's `router.ts` is exactly such a hand-built bridge: HTTP `POST /event` → `actor.send(...)`; `GET /projection` → derive from `actor.getSnapshot()`; SSE stream → the `subscribe`-equivalent. This confirms the *shape* of the hypothesis (event-in/state-out) is the idiomatic way to expose an XState actor, while showing the single-endpoint detail is an application choice XState neither prescribes nor forbids.

### Finding 2: Persisted snapshots — `getPersistedSnapshot()` / `createActor({ snapshot })` is the official rehydration contract; invocations restart, actions do not
**Evidence**: "Getting persisted state: `const persistedState = actor.getPersistedSnapshot();`". "Restoring: `const restoredActor = createActor(machine, { snapshot: restoredState }).start();`". `getPersistedSnapshot()` "retrieves internal actor state for storage, distinct from `getSnapshot()` which returns the last emitted value." Deep persistence: "All invoked & spawned actors will be persisted and restored recursively." On restore, **actions are "not re-executed, because they are assumed to have been already executed" — but invocations restart.** Persisted state "requires JSON serializability and may become incompatible if machine definitions change significantly." Event sourcing (replaying events via `actor.send(event)`) is offered as an alternative with "better compatibility and action replay."
**Source (PRIMARY)**: [Stately — Persistence](https://stately.ai/docs/persistence) — Accessed 2026-05-29. Reputation: High (1.0, official).
**Confidence**: High (single authoritative/primary source).
**Analysis**: This directly validates the codebase's hybrid persistence design. (1) Deep recursive persistence of invoked children is exactly why the single ChatApp parent snapshot captures all three children (`ui-state/lib/machines/chat-app/snapshot.ts`). (2) "Invocations restart on restore" is precisely the R3 hazard the codebase guards against: `isSettledForSnapshot` blocks persisting while a `fromPromise` create* invoke is mid-flight, so the non-idempotent `createProject`/`createSessionEagerly` invokes can never double-fire on rehydrate. (3) "Incompatible if machine definitions change significantly" is the snapshot-version-coupling risk the team must own (see Open Questions). (4) The docs explicitly contrast snapshot-restore vs event-sourcing — the codebase chose snapshot-as-state-of-record (ADR-044) demoting the event log to audit/SSE, which the docs frame as the trade-off of compatibility vs simplicity.

### Finding 1b: `@xstate/react` is a client-side consumer; it does NOT natively observe a remote actor
**Evidence**: `useMachine(machine, options?)` returns `[snapshot, send, actorRef]` ("a tuple of snapshot, send function, and started actor"); `useActor(actorLogic)` "creates an actor … and starts an actor that runs for the lifetime of the component"; `useActorRef(machine)` returns the actor ref only; `useSelector(actorRef, selector, compare?)` "only cause[s] a rerender if the selected value changes"; `createActorContext(logic)` yields a Context with `.Provider`/`.useSelector()`/`.useActorRef()`. The React layer **creates and runs actors client-side within component lifetimes**; the docs show **no support for observing remote/external actors** — all hooks create fresh local actors.
**Source (PRIMARY)**: [Stately — @xstate/react](https://stately.ai/docs/xstate-react) — Accessed 2026-05-29. Reputation: High (1.0, official).
**Confidence**: High (primary).
**Analysis**: This is the load-bearing reason a server-side XState deployment does **not** use `useMachine` to talk to the server actor. When the machine lives on the server (as in this codebase), the React side cannot point `@xstate/react` at it — there is no remote-actor adapter. Instead the FE consumes a **projection** (a plain JSON read model) via normal data-fetching (TanStack Query / RRv7 loaders, per ADR-027) and sends events via plain HTTP `POST`. `useSelector`'s "rerender only if selected value changes" is the *local* analog of what the codebase achieves remotely by deriving a stable, narrow projection rather than streaming raw snapshot churn. So the server-XState pattern deliberately substitutes "HTTP + projection" for the `@xstate/react` hooks; the hypothesis's "FE sends events, machine returns state" is the correct cross-network substitution for the missing remote-actor hook.

### Finding 3: "Actor on the server, events over the wire" is a real community pattern but NOT a packaged XState transport (SPECULATIVE on prevalence)
**Evidence**: Stately's own materials state teams use XState "to manage backend workflows and critical business logic," confirming server-side use is endorsed in principle. However, both the official actor docs and a targeted search surfaced **no official, packaged HTTP/WebSocket transport** for sending events to a server-resident actor; community write-ups (e.g. Sandro Maglione's XState v5 articles) cover actors/`fromPromise` for async work but the search "[did] not contain specific patterns for implementing HTTP-based event communication between server actors." The canonical building blocks remain `actor.send` (event-in), `getSnapshot`/`getPersistedSnapshot` (state-out), `subscribe` (push).
**Source (PRIMARY)**: [Stately — XState v5 is here](https://stately.ai/blog/2023-12-01-xstate-v5) (server/backend-workflow framing). **Source (SECONDARY)**: [Sandro Maglione — State machines and Actors in XState v5](https://www.sandromaglione.com/articles/state-machines-and-actors-in-xstate-v5) — Accessed 2026-05-29. Reputation: High (primary) / Medium (secondary, named author, verify). Cross-ref: the [Actors](https://stately.ai/docs/actors) doc (Finding 1) corroborates the absence of a network primitive.
**Confidence**: Medium — that the pattern *exists and is endorsed* is well-supported; the claim that "single POST /event returning state" is *the* community-canonical shape is **SPECULATIVE** (no single authoritative source prescribes one endpoint shape; it is an application-design choice).
**Analysis**: This is the central nuance for the hypothesis. There is no "right answer" handed down by XState — the team owns the transport design. The codebase's choice (one actor per principal, event-in via `POST /event`, derived-projection out, SSE for push) is a defensible, idiomatic instantiation of the primitives, but the *number of endpoints* and *whether state-out is raw snapshot or projection* are local decisions the evidence below (Findings 5–8) informs.

### Finding 4: XState ignores events with no matching transition by default (no error, no state change)
**Evidence**: "XState ignores events that don't have matching transitions in the current state by default." The transition-selection algorithm: "If no transition is enabled, no transitions will be taken, and the state will not change." A *forbidden transition* (defined with no target/actions) explicitly stops the algorithm looking in parent states; a *wildcard transition* (`*`) "has the least priority; it will only be taken if no other transitions are enabled" — a catch-all for unhandled events. A maintainer note (Discussion #1900) clarifies the v5 nuance: an unhandled event is "technically a state change … because `.event` changes, but it wouldn't be a transition."
**Source (PRIMARY)**: [Stately — Transitions](https://stately.ai/docs/transitions) — Accessed 2026-05-29. Reputation: High (1.0, official). **Cross-ref (PRIMARY, maintainer forum)**: [statelyai/xstate Discussion #1900 — ignore unhandled events](https://github.com/statelyai/xstate/discussions/1900) — Accessed 2026-05-29. Reputation: High (0.9, official repo, maintainer participation).
**Confidence**: High (two primary sources agree).
**Analysis**: This is a double-edged property at a network boundary. (1) **Robustness:** forwarding an event the active child does not model is a safe no-op server-side — the actor will not throw or corrupt. This is *why* the codebase can forward `{type,payload}` verbatim on the non-onboarding wires (`forwardToActor` → `child_event`) without exhaustive validation. (2) **Silent-failure hazard:** because an unmodeled event silently does nothing, a client that sends a stale/typo'd/wrong-version event gets a 200 with an unchanged projection and no signal that its event was dropped. This is the strongest evidence FOR keeping a **closed, validated vocabulary** on at least the safety-critical wire — exactly what the onboarding wire does (`onboardingEventSchema` discriminated union → unmodeled `type` = HTTP 400). It also motivates event-schema versioning and explicit unknown-event handling at the HTTP edge (see Finding 8 + Open Questions). A single unified chat-app endpoint inherits this trade-off: it must decide per-event-type whether to validate (closed ACL) or forward verbatim (open passthrough) — the codebase already splits exactly this way.

### Finding 5: Returning a DERIVED projection (not the raw persisted snapshot) is the safer wire contract
**Evidence**: XState's own docs distinguish `getPersistedSnapshot()` (internal actor state for storage) from `getSnapshot()` (last emitted value), and warn that persisted state "may become incompatible if machine definitions change significantly" ([Stately — Persistence](https://stately.ai/docs/persistence)). The codebase's own `chatapp-snapshot-store.ts` header states the persisted snapshot is "the OPAQUE XState persisted-snapshot structure … XState-internal + machine-definition-coupled" and that "the FE projection is NEVER derived from raw snapshot internals; it is derived through the contract-tested mapper." The general principle that a stable published contract should not expose internal structure is the core of the **Published Interface** / consumer-driven-contract guidance (Fowler) and the encapsulation rationale behind API DTOs.
**Source (PRIMARY)**: [Stately — Persistence](https://stately.ai/docs/persistence) (snapshot is internal + version-coupled) — Accessed 2026-05-29. Reputation: High. **Source (PRIMARY, secondary-corroboration on the contract principle)**: [Martin Fowler — PublishedInterface](https://martinfowler.com/bliki/PublishedInterface.html) — Accessed 2026-05-29. Reputation: Medium-High (0.8, industry leader). **In-repo corroboration**: `ui-state/lib/machines/chat-app/projection/derive-projection.ts` (the byte-stable `FlowProjection` mapper); ADR-027 §4 (frozen 7-field envelope).
**Confidence**: High (primary + corroborating industry source + the codebase's own contract tests).
**Analysis**: Returning the raw `getPersistedSnapshot()` over the wire would couple every FE/auth-proxy reader to XState's internal serialization shape AND to the exact child-machine definitions — so any machine refactor risks a breaking wire change, and the auth-proxy "KPI sniffer" that reads literal state strings would break. The codebase decisively chose **derived projection out**, not raw snapshot out (ADR-044 §2: "do not derive the FE projection from raw snapshot internals; derive through a contract-tested mapper"). This refines the hypothesis: "the machine returns the updated state" should mean **the derived projection**, not `actor.getPersistedSnapshot()`. The hypothesis is right that state-out is the response; the evidence says that state must be a stable projection.

### Finding 6: Request/response covers the user's own events; SSE (one-way push) covers externally-changing state; WebSocket only when bidirectional is needed
**Evidence**: MDN: SSE is "a one-way connection, so you can't send events from a client to a server"; it runs over standard HTTP with MIME `text/event-stream`, fields `event:`/`data:`/`id:`/`retry:`, and **automatic reconnection** ("if the connection … closes, the connection is restarted"), with `Last-Event-ID` resumption via the `id:` field. WebSocket is "bidirectional, requires separate protocol upgrade." MDN flags a real constraint: over HTTP/1.1, SSE is limited to **6 connections per browser**; HTTP/2+ negotiates up to ~100 streams.
**Source (PRIMARY)**: [MDN — Using Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events) — Accessed 2026-05-29. Reputation: High (1.0, canonical web reference). **Cross-ref (PRIMARY, official)**: the codebase's SSE design references DWD-9/RD2; corroborated by ADR-027 §1 endpoint `GET …/projection/stream`.
**Confidence**: High (canonical primary).
**Analysis**: This validates the codebase's split precisely. The user's *own* intents are request/response (`POST /event` returns the fresh projection synchronously after `settle()`), which is the natural request/response loop and needs no push. But state that changes **outside the user's own request** — e.g. an agent co-authoring the chat, or background child transitions — cannot be delivered by request/response alone; that is exactly SSE's one-way server→client niche, and the codebase exposes `GET /projection/stream` (first frame = current projection, then re-derive on each retained-log event). WebSocket would be over-engineering here because the FE→server direction is already served by ordinary HTTP POST; the only push need is server→FE, which SSE handles with built-in reconnection. The 6-connection HTTP/1.1 limit is a real operational caveat (one stream per open machine-projection per tab) that argues *for* collapsing to a single chat-app projection stream (see Fit Analysis + Open Questions).

### Finding 7: Optimistic UI is a client concern layered over a server-authoritative model; the two coexist
**Evidence**: React's docs frame optimistic UI via `useOptimistic` — "optimistically update the UI … the value will revert to [the actual value] once the action … completes," i.e. a temporary client-side guess reconciled with the authoritative server response. TanStack Query documents optimistic updates with explicit rollback on error (`onError` reverts the cache) and final reconciliation by refetch/`onSettled`. XState's server-authoritative posture (Findings 1–2, ADR-044: "the live actor is the state-of-record") is the authoritative side this reconciles against.
**Source (PRIMARY)**: [React — useOptimistic](https://react.dev/reference/react/useOptimistic) — Accessed 2026-05-29. Reputation: High (1.0, official). **Source (PRIMARY, library docs)**: [TanStack Query — Optimistic Updates](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates) — Accessed 2026-05-29. Reputation: High (0.9, official library docs). **In-repo**: ADR-044 (server-authoritative live actor); CLAUDE.md (FE uses TanStack Query).
**Confidence**: High (two primary/official sources; well-established pattern).
**Analysis**: The hypothesis ("machine returns the updated state") is inherently **server-authoritative**, which is the correct default for state the agent co-authors and that multiple surfaces must agree on (the whole JOB-002 rationale in ADR-027 — no parallel FE-internal state). Optimistic UI is *not* in tension with this: the FE may render an optimistic guess on `POST /event` and then reconcile against the returned projection (or the next SSE frame), reverting on mismatch. The key design rule the evidence supports: the **server projection is the single source of truth**; optimism is a presentation-layer affordance that must always reconcile to it. A single chat-app endpoint that returns the authoritative projection on every event is fully compatible with FE optimism.

### Finding 8: Identity should be derived server-side from verified principal; non-idempotent POSTs need idempotency keys + correlation ids
**Evidence**: RFC 9110 §9.2.2: idempotent methods are those where "the intended effect on the server of multiple identical requests is the same as the effect for a single such request"; GET/HEAD/PUT/DELETE/OPTIONS/TRACE are idempotent, **POST is explicitly NOT**. The IETF `Idempotency-Key` draft: the header "can be used to make non-idempotent HTTP methods such as POST or PATCH fault-tolerant" — the client supplies a unique key; the server "cache[s] responses associated with each idempotency key" and on a duplicate "returns the previously cached response rather than re-executing the operation." Least-privilege identity ("derive identity server-side, do not accept it from the client") is a standard security posture; the codebase already applies it (ADR-040 amendment 2026-05-25).
**Source (PRIMARY)**: [IETF RFC 9110 §9.2.1–9.2.2](https://datatracker.ietf.org/doc/html/rfc9110) — Accessed 2026-05-29. Reputation: High (1.0, standards body). **Source (PRIMARY, standards-track draft)**: [IETF draft-ietf-httpapi-idempotency-key-header](https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header/) — Accessed 2026-05-29. Reputation: High (0.9, IETF draft; note: the fetched revision page was an EXPIRED draft snapshot — see Knowledge Gaps). **In-repo**: ADR-040 amendment (flow_id derived from `X-User-Id`, not client-supplied; cross-principal 403 deleted as dead code); router.ts (`principal_id = c.req.header("X-User-Id")`).
**Confidence**: High for RFC 9110 (authoritative). Medium for the Idempotency-Key draft (standards-track but not an RFC; the fetched page was an expired revision).
**Analysis**: Two implications. (1) **Identity:** the codebase already implements the least-privilege pattern the hypothesis should adopt — `POST /event` is keyed by the header-injected `X-User-Id`, not a client-supplied flow_id; ADR-040's amendment explicitly deletes the cross-principal 403 because a derived identity makes cross-principal addressing *unrepresentable*. A single chat-app endpoint should keep this: no `:principal` path param, no body identity. (2) **Idempotency:** `POST /event` is non-idempotent by RFC 9110, and the codebase has genuinely non-idempotent effects behind it (the `createProject`/`createSessionEagerly` invokes). Today the snapshot-settle guard (R3) prevents *rehydration* double-fire, but it does **not** dedupe a client that retries the same `POST /event` after a network timeout — a duplicate could re-fire a create. An `Idempotency-Key` (or reusing `X-Request-Id` as a correlation/dedup key) is the standards-aligned mitigation, and is a live gap to flag (see Open Questions).

### Finding 7b: React `useOptimistic` reconciles to the real value in a single render (no flash)
**Evidence**: "`useOptimistic` is a React Hook that lets you optimistically update the UI." On completion: "There's no extra render to 'clear' the optimistic state. The optimistic and real state converge in the same render when the Transition completes" — "if `saveChanges` returned `'c'`, then both `value` and `optimistic` will be `'c'`."
**Source (PRIMARY)**: [React — useOptimistic](https://react.dev/reference/react/useOptimistic) — Accessed 2026-05-29. Reputation: High (1.0, official). Confidence: High.
**Analysis**: Confirms Finding 7 — optimism is a clean presentation affordance that converges on the server-authoritative response, reinforcing that "machine returns the updated state" (server-authoritative) and FE optimism compose without conflict.

### Finding 9 (negative): The XState `inspect` / Inspection API is observability-only, NOT a state-sync transport
**Evidence**: The Inspect API is "designed for observability and developer tooling, not for state synchronization across client/server boundaries"; it streams inspection events (actor lifecycle, event communication, snapshot updates, microsteps) to tools like Stately Inspector. It is "not a production state-sync mechanism."
**Source (PRIMARY)**: [Stately — Inspection](https://stately.ai/docs/inspection) — Accessed 2026-05-29. Reputation: High (1.0, official). Confidence: High (primary).
**Analysis**: Rules out a tempting wrong turn — one might imagine piping `inspect` events to the FE as the state-sync channel. The docs say no: inspection is for devtools/audit, not for FE state. The codebase correctly uses a purpose-built projection + SSE for FE sync and reserves snapshot/log for internal/audit concerns. (Aligns with ADR-028 OQ#3: inspector disabled in prod by default.)

## Trade-off Matrix

Each row scored for THIS codebase's context (single-replica, agent-co-authored state, frozen FE wire). Legend: ✅ matches current design · ⚠️ caveat · ❌ rejected.

### A. Single event endpoint vs per-command REST endpoints

| Dimension | Single `POST /event` (event-in/state-out) | Per-command REST (`POST /projects`, `POST /sessions`, …) |
|---|---|---|
| Coupling to machine vocabulary | Low — one route; vocabulary lives in the machine/ACL | High — every command is a new route + handler |
| Maps to actor `send(event)` | ✅ Direct 1:1 (Finding 1) | Impedance mismatch — REST verbs vs machine events |
| Unknown/stale events | Safe no-op by default (Finding 4) — but silent | 404/405 surfaces the error explicitly |
| Discoverability / REST idiom | Lower (one opaque verb sink) | Higher (resource-oriented, cacheable GETs) |
| Validation | Per-event ACL or verbatim passthrough (codebase does both) | Per-route schema, natural |
| **Fit** | ✅ The codebase + hypothesis choose this; idiomatic for actor exposure | ❌ Rejected — recapitulates the orchestrator fan-out ADR-040 deleted |

### B. Full raw snapshot vs derived/projected view (state-out shape)

| Dimension | Raw `getPersistedSnapshot()` out | Derived `FlowProjection` out |
|---|---|---|
| Wire stability across machine refactors | ❌ Breaks on any internal change (Finding 2, 5) | ✅ Byte-stable contract (ADR-027/044) |
| Couples FE to XState internals | ❌ Yes (version-coupled, opaque) | ✅ No — stable 7-field envelope |
| Payload size / noise | Larger, internal noise | Smaller, intentional |
| auth-proxy KPI sniffer (reads literal state strings) | ❌ Would break | ✅ Preserved |
| **Fit** | ❌ Rejected by ADR-044 explicitly | ✅ Current design; refines hypothesis (return projection, not snapshot) |

### C. Request/response vs server-push (SSE vs WebSocket)

| Dimension | Request/response only | + SSE (one-way push) | WebSocket (bidirectional) |
|---|---|---|---|
| User's own events | ✅ Natural (POST → fresh projection) | (same) | Overkill for FE→server |
| Externally-changing state (agent co-author, bg transitions) | ❌ Cannot deliver | ✅ SSE's exact niche (Finding 6) | ✅ but heavier |
| Reconnection | n/a | ✅ Built-in + `Last-Event-ID` | Manual |
| Transport | Plain HTTP | Plain HTTP (`text/event-stream`) | Protocol upgrade |
| HTTP/1.1 connection cap | n/a | ⚠️ 6/browser — argues for ONE stream | n/a |
| **Fit** | Necessary but insufficient alone | ✅ Current design (`POST /event` + `GET /projection/stream`) | ❌ Unjustified (no bidirectional need) |

### D. Optimistic UI vs server-authoritative state

| Dimension | Pure optimistic (client-authoritative) | Server-authoritative (+ optional FE optimism) |
|---|---|---|
| Agreement across surfaces (FE, harness, agent) | ❌ Drifts (the JOB-002 bug class) | ✅ Single source of truth (ADR-027) |
| Agent co-authoring | ❌ Client can't be authoritative | ✅ Server owns state; SSE pushes |
| Perceived latency | Best | Good; FE optimism + reconcile closes the gap (Findings 7/7b) |
| **Fit** | ❌ Rejected (the problem ADR-027 exists to kill) | ✅ Current design; compatible with FE `useOptimistic`/TanStack rollback |

## Fit Analysis for THIS Codebase

The headline finding: **the codebase already implements most of the hypothesis.** The genuinely-open part is narrow.

### What ALREADY matches the established patterns (KEEP)

| Pattern (from Findings) | Where it lives | Verdict |
|---|---|---|
| Event-in / state-out via actor `send`/`getSnapshot` (F1) | `router.ts` `POST /event` → `forwardToActor` → `actor.send`; response is the derived projection | ✅ Idiomatic — keep |
| ONE actor per principal (in-process, single-replica) | `ChatAppActorRegistry`; ADR-030 single-replica | ✅ Matches XState in-process model; keep until ceiling triggers |
| Derived projection out, NOT raw snapshot (F2, F5) | `derive-projection.ts`; ADR-044 §2; ADR-027 §4 | ✅ Best-practice; keep — the byte-stable contract is the asset |
| Snapshot persistence with settled-state-only guard (F2) | `snapshot.ts` `isSettledForSnapshot` (R3); `chatapp-snapshot-store.ts` | ✅ Correctly mitigates "invocations restart on restore" |
| SSE for externally-changing state (F6) | `GET /projection/stream` | ✅ Correct transport choice over WebSocket |
| Server-authoritative state (F7) | ADR-044 "live actor is state-of-record" | ✅ Correct default; FE optimism layers cleanly |
| Identity DERIVED server-side from verified principal (F8) | `principal_id = X-User-Id`; ADR-040 amendment (no client flow_id; 403 deleted) | ✅ Least-privilege; **strong match** — keep verbatim |
| Closed validated vocabulary where it matters (F4) | onboarding `onboardingEventSchema` → 400; verbatim `child_event` elsewhere | ✅ Correctly splits validate-vs-forward |
| Unknown events safely ignored (F4) | XState default; relied on by verbatim forwarding | ✅ Robust — but pair with versioning (see risks) |

### What is BESPOKE to this codebase (not prescribed by XState; local design)

- **THREE per-machine wire paths** (`login-and-org-setup` / `project-and-chat-session-management` / `session-chat`, + 2 canonical aliases = 5 mounts) all backed by ONE actor via a single `buildChatAppRouter(runtime, wireMachine)` factory. XState prescribes none of this; it is a frozen-contract compatibility artifact (ADR-027 froze the per-machine `GET /flow/{machine}/projection` envelope; the live FE root loader + route loaders + auth-proxy KPI sniffer read all three).
- **`flow_id = {wireMachine}:{principal}`** synthesized server-side with the wire ALIAS kept verbatim in the key (`derive-projection.ts`) — purely to keep legacy FE/harness reads from 404ing.
- **Hybrid persistence** (snapshot = state-of-record; event log demoted to SSE/audit + bookkeeping) — a local trade-off (ADR-044 §2) chosen over pure event-sourcing or pure store-model (ADR-030 tripwire / ADR-040 store-model are the documented alternatives).

### What a SINGLE chat-app endpoint would CHANGE

This is **exactly ADR-044 §5 Open Question #3**: "Unify the external projection wire (one ChatApp projection instead of per-machine) — a follow-on FE + auth-proxy story, not required for the pivot."

- **Writes already are effectively unified**: all of `/begin`, `/event`, `/open-deep-link` target the SAME per-principal ChatApp actor regardless of which of the 5 mounts they arrive on. The write side is single-actor TODAY; only the *path multiplicity* is cosmetic.
- **Reads are the real surface to collapse**: today three derived `FlowProjection`s (one per child slice). A single chat-app endpoint would return ONE composite projection covering onboarding + project-context + session-chat in one envelope.
- **The blockers are downstream, not in ui-state**: (1) the FE reads all three projections from distinct loaders (ADR-027 §2); (2) auth-proxy's KPI sniffer reads literal per-machine state strings; (3) ADR-027 froze the per-machine envelope. Collapsing requires a coordinated FE + auth-proxy ripple — which ADR-044 §5 OQ#3 and ADR-040 LEAF-6 (remove alias map once FE is on canonical paths) both already anticipate.

## Concrete Recommended API Shape

**Recommendation: confirm the hypothesis's *mechanism* (it is already live and correct), and treat the *single-surface unification* as an optional, separately-sequenced FE+auth-proxy story — not a ui-state rewrite.** The single-endpoint idea is sound and well-supported, but its value is FE/ops simplification (fewer SSE streams per the HTTP/1.1 cap in F6; one loader), not a correctness fix. Ship it when the FE+auth-proxy ripple is funded (ADR-044 §5 OQ#3).

### Target shape for a unified chat-app coordinator endpoint

```
Path (mounted behind auth-proxy at /ui-state/chat-app/*):
  POST   /ui-state/chat-app/begin            # cold-start / force-restart the principal's actor
  POST   /ui-state/chat-app/event            # forward ONE event to the principal's actor
  GET    /ui-state/chat-app/projection       # composite derived projection (read)
  GET    /ui-state/chat-app/projection/stream# SSE: first frame + re-derive on each retained-log event
```

- **Identity source**: header-derived ONLY — `principal_id = X-User-Id` (auth-proxy injects from the re-verified Bearer). No `:principal` path param, no body identity. (F8 + ADR-040 amendment — keep verbatim.)
- **Request body = the event**: `{ "type": "...", "payload": { ... } }`. Validate against a closed discriminated union for safety-critical types (onboarding) and forward the rest verbatim as `child_event` (F4). Optionally accept an `Idempotency-Key` header (or reuse `X-Request-Id`) to dedupe retried non-idempotent POSTs (F8).
- **Response = the DERIVED composite projection**, never the raw snapshot (F2, F5). Server-authoritative (F7).
- **Push** = SSE on `/projection/stream` for agent-co-authored / background transitions (F6); `Last-Event-ID`/`since` cursor for resume.

### Example request / response

`POST /ui-state/chat-app/event`
```http
POST /ui-state/chat-app/event HTTP/1.1
Authorization: Bearer <token>
X-User-Id: user-001
X-Request-Id: 7f3c…
Idempotency-Key: 7f3c…            # optional; dedupe retries of this exact event
Content-Type: application/json

{ "type": "org_form_submitted", "payload": { "org_name": "Acme" } }
```

Response (composite projection — the three per-machine slices folded into one envelope):
```json
{
  "principal_id": "user-001",
  "phase": "engaged.project_context",
  "request_id": "7f3c…",
  "sequence_id": 4,
  "last_event_at": "2026-05-29T12:00:00.000Z",
  "active_scope": { "org_id": "org-001", "project_id": null, "resource_type": null, "resource_id": null },
  "machines": {
    "login-and-org-setup":               { "state": "ready",                  "context": { "org": { "id": "org-001", "name": "Acme" }, "user": { "first_name": "Z" } } },
    "project-and-chat-session-management": { "state": "resolving_initial_scope", "context": { "project": { "id": null, "name": null } } },
    "session-chat":                      { "state": "verifying",              "context": {} }
  }
}
```

### How the 3 per-machine projections map onto / coexist with one surface

- **Coexistence (low-risk, recommended first step)**: keep the three `GET /flow/{machine}/projection` reads byte-stable (they already are — `deriveProjection` is contract-tested) AND add the composite `GET /chat-app/projection` as an additive surface. The composite is just `{ machines: { [wireMachine]: deriveProjection(snapshot, wireMachine, bk) } }` plus the top-level `phase`/`active_scope`. No internal change — pure additive read.
- **Collapse (later, gated)**: once the FE root+route loaders read the composite and auth-proxy's KPI sniffer is repointed at `machines.<name>.state`, retire the per-machine reads and the alias map (ADR-040 LEAF-6). This is the FE+auth-proxy ripple ADR-044 §5 OQ#3 names.

### Migration implications given the existing ADRs

- **ADR-027 (frozen wire)**: the 7-field per-machine envelope cannot change until the FE migrates. ⇒ add the composite additively; do not mutate the existing three.
- **ADR-040 (alias map)**: the 5 mounts + alias-to-canonical map stay until LEAF-6; the composite endpoint is a NEW mount, not a replacement, during coexistence.
- **ADR-030 (single replica / derived flow_id)**: unchanged — one actor per principal in one process; identity derived from `X-User-Id`. The composite reads the same single actor; no topology delta. (If multi-replica is ever needed, Option γ sticky-routing on principal applies equally.)
- **ADR-044 §2 (hybrid persistence)**: unchanged — composite derives from the same snapshot + bookkeeping log; SSE substrate is reused.

## Open Questions / Risks

1. **Event-schema versioning & unknown-event silence (F4).** Unmodeled events are a silent no-op. As the machine evolves, an old FE could send a now-removed event and receive a 200 with unchanged state and no signal. *Risk:* silent client/server drift. *Mitigation to evaluate:* a wire `schema_version`, or echoing an `accepted: false`/`unhandled` marker for events the active child did not model (requires reading whether the snapshot changed — XState v5 notes an unhandled event changes `.event` but is "not a transition," F4).
2. **Snapshot version coupling on rehydrate (F2).** `getPersistedSnapshot()` "may become incompatible if machine definitions change significantly." A deploy that changes a child machine can make a persisted snapshot un-rehydratable. *Mitigation already partly in place:* ADR-044 notes the `ui-state:` keyspace is ephemeral/flushed on deploy (snapshots are hot-restart-only, not durable history). Confirm the flush-on-deploy discipline holds for the `ui-state:chatapp:{principal}:snapshot` key, and consider a snapshot `version` tag that forces a clean cold-start on mismatch.
3. **Idempotency of non-idempotent POSTs (F8).** `POST /event` can trigger non-idempotent create* invokes. The R3 settled-guard prevents *rehydration* double-fire but NOT *client-retry* double-fire (same event re-POSTed after a timeout). *Mitigation:* honor an `Idempotency-Key` (IETF draft) — cache the response per key and return the cached projection on replay.
4. **Push for agent-co-authored state (F6).** SSE is the right transport, but the current stream re-derives on each retained-log event. Confirm agent co-authoring actually appends to the retained log (or otherwise triggers a re-derive) so the FE sees agent edits without a poll. The HTTP/1.1 6-connection cap is a real reason to prefer ONE composite stream over three.
5. **Optimistic UI reconciliation (F7).** If the FE adopts `useOptimistic`/TanStack optimism, define the reconcile/rollback rule against the authoritative projection (revert on POST error or on a contradicting SSE frame). Keep the projection the single source of truth.
6. **Multi-replica future (ADR-030 Option γ).** In-process actors mean a single composite endpoint is still single-replica-bound. If a scaling ceiling fires, sticky-routing on `X-User-Id` (consistent hash) is the documented path; the composite endpoint does not change that calculus.
7. **Composite projection shape is a NEW contract (not yet ratified).** The `{ phase, active_scope, machines: {…} }` envelope above is a *proposed* shape, not an existing one — it needs FE + auth-proxy sign-off (the consumers ADR-027 froze the old wire for). Treat the JSON example as illustrative, not normative, until that story is written.

## Source Analysis

| Source | Domain | Reputation | Type | Primary/Secondary | Access Date | Cross-verified |
|--------|--------|------------|------|-------------------|-------------|----------------|
| Stately — Actors | stately.ai | High (1.0) | Official docs | Primary | 2026-05-29 | Y (F1/F3) |
| Stately — Persistence | stately.ai | High (1.0) | Official docs | Primary | 2026-05-29 | Y (F2/F5) |
| Stately — @xstate/react | stately.ai | High (1.0) | Official docs | Primary | 2026-05-29 | Y (F1b) |
| Stately — Transitions | stately.ai | High (1.0) | Official docs | Primary | 2026-05-29 | Y (F4 vs Disc #1900) |
| Stately — Inspection | stately.ai | High (1.0) | Official docs | Primary | 2026-05-29 | Y (F9) |
| Stately — XState v5 is here (blog) | stately.ai | High (1.0) | Official blog | Primary | 2026-05-29 | Y (F3) |
| statelyai/xstate Discussion #1900 | github.com | High (0.9) | Maintainer forum | Primary | 2026-05-29 | Y (F4) |
| MDN — Using Server-Sent Events | developer.mozilla.org | High (1.0) | Canonical web ref | Primary | 2026-05-29 | Y (F6) |
| IETF RFC 9110 (HTTP Semantics) | datatracker.ietf.org | High (1.0) | Standards body | Primary | 2026-05-29 | Y (F8) |
| IETF Idempotency-Key draft | datatracker.ietf.org | High (0.9) | Standards-track draft | Primary | 2026-05-29 | partial (F8; expired revision) |
| React — useOptimistic | react.dev | High (1.0) | Official docs | Primary | 2026-05-29 | Y (F7/F7b) |
| TanStack Query — Optimistic Updates | tanstack.com | High (0.9) | Official library docs | Primary | 2026-05-29 | Y (F7) |
| Martin Fowler — PublishedInterface | martinfowler.com | Medium-High (0.8) | Industry leader | Secondary | 2026-05-29 | Y (F5) |
| Sandro Maglione — XState v5 actors | sandromaglione.com | Medium (0.6) | Community (named author) | Secondary | 2026-05-29 | Y (F3, corroboration only) |

Reputation distribution: High 12 (86%) · Medium-High 1 (7%) · Medium 1 (7%). Average ≈ 0.95. No excluded-tier sources cited. No prompt-injection or adversarial content detected in fetched pages.

## Knowledge Gaps

### Gap 1: No official XState-packaged HTTP/WebSocket actor transport
**Issue**: XState provides local primitives but no first-party network transport; the "actor on the server, events over HTTP" pattern is application-level, not packaged. **Attempted**: Stately actors/persistence docs, v5 blog, targeted web search, GitHub discussions. **Recommendation**: Treat the codebase's `router.ts` bridge as the reference implementation; there is no upstream contract to conform to. Re-check `@xstate/store` and any future Stately "agent"/server-actor packages on the next framework-version review.

### Gap 2: Prevalence of "single POST /event" as the community-canonical shape is SPECULATIVE
**Issue**: No single authoritative source prescribes endpoint count/shape for exposing a server actor; "one event endpoint vs per-command REST" is an application-design choice. **Attempted**: web search for the server-actor HTTP pattern. **Recommendation**: Rely on the trade-off matrix (Section A) for the decision, not on an appeal to authority. Confidence on this specific sub-claim is Medium.

### Gap 3: Idempotency-Key draft fetched as an EXPIRED revision
**Issue**: The fetched datatracker page was an expired Internet-Draft snapshot lacking the full normative text on key-uniqueness scope/TTL. **Attempted**: datatracker draft page. **Recommendation**: Pull the latest active revision of `draft-ietf-httpapi-idempotency-key-header` before implementing; the abstract + mechanism are confirmed, the detailed requirements are not. RFC 9110's idempotency definition (the load-bearing claim) is unaffected — it is a ratified RFC.

### Gap 4: Composite chat-app projection shape is proposed, not ratified
**Issue**: The `{ phase, active_scope, machines: {…} }` envelope is a research proposal; the actual consumers (FE loaders, auth-proxy KPI sniffer) have not signed off. **Recommendation**: Treat as illustrative; the binding shape is a DISCUSS/DESIGN output for the ADR-044 §5 OQ#3 story.

## Full Citations / References Bibliography

### Web sources
[1] Stately. "Actors". XState v5 Documentation. https://stately.ai/docs/actors. Accessed 2026-05-29. PRIMARY, High.
[2] Stately. "Persistence". XState v5 Documentation. https://stately.ai/docs/persistence. Accessed 2026-05-29. PRIMARY, High.
[3] Stately. "@xstate/react". XState v5 Documentation. https://stately.ai/docs/xstate-react. Accessed 2026-05-29. PRIMARY, High.
[4] Stately. "Transitions". XState v5 Documentation. https://stately.ai/docs/transitions. Accessed 2026-05-29. PRIMARY, High.
[5] Stately. "Inspection". XState v5 Documentation. https://stately.ai/docs/inspection. Accessed 2026-05-29. PRIMARY, High.
[6] Stately. "XState v5 is here". Stately Blog. 2023-12-01. https://stately.ai/blog/2023-12-01-xstate-v5. Accessed 2026-05-29. PRIMARY, High.
[7] statelyai/xstate. "Can the state machine ignore unhandled events… Discussion #1900". GitHub. https://github.com/statelyai/xstate/discussions/1900. Accessed 2026-05-29. PRIMARY, High.
[8] MDN Web Docs. "Using server-sent events". Mozilla. https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events. Accessed 2026-05-29. PRIMARY, High.
[9] IETF. "RFC 9110: HTTP Semantics" (§9.2.1 Safe, §9.2.2 Idempotent Methods). https://datatracker.ietf.org/doc/html/rfc9110. Accessed 2026-05-29. PRIMARY, High.
[10] IETF. "The Idempotency-Key HTTP Header Field" (draft-ietf-httpapi-idempotency-key-header). https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header/. Accessed 2026-05-29. PRIMARY, High (expired revision fetched — see Gap 3).
[11] React. "useOptimistic". react.dev. https://react.dev/reference/react/useOptimistic. Accessed 2026-05-29. PRIMARY, High.
[12] TanStack. "Optimistic Updates". TanStack Query v5 Docs. https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates. Accessed 2026-05-29. PRIMARY, High.
[13] Fowler, Martin. "PublishedInterface". martinfowler.com. https://martinfowler.com/bliki/PublishedInterface.html. Accessed 2026-05-29. SECONDARY, Medium-High.
[14] Maglione, Sandro. "State machines and Actors in XState v5". sandromaglione.com. https://www.sandromaglione.com/articles/state-machines-and-actors-in-xstate-v5. Accessed 2026-05-29. SECONDARY, Medium (named author; corroboration only).

### In-repo references (verified by reading)
- `docs/decisions/adr-027-flow-state-tier-and-framework.md` — ui-state as dedicated Hono service; the frozen 7-field `FlowProjection` wire format; `GET /projection`, `GET /projection/stream` (SSE), `POST /events`; per-machine read contract; OQ#3 = delta encoding deferred.
- `docs/decisions/adr-028-xstate-v5-actor-model.md` — XState v5 actor model; "one root orchestrator actor mediating parent-ignorant children"; "no machine imports another"; amendment "machines own transitions, the log owns state"; persistence via getPersistedSnapshot for hot-restart only.
- `docs/decisions/adr-030-flow-state-topology-and-scaling.md` — `flow_id = <machine>:<principal_id>`; single-replica (in-process actors; multi-replica = sticky-routing Option γ deferred); behind auth-proxy; emission-completeness tripwire.
- `docs/decisions/adr-040-ui-state-hexagonal-transport.md` — hexagonal transport; per-machine sub-routers via shared factory, NO `:machine` param; registry keyed by canonical machine-name + alias map; 2026-05-25 amendment "flows addressed by VERIFIED IDENTITY, not client-supplied flow_id" (derive server-side; cross-principal 403 deleted) — strong evidence for derive-identity-server-side.
- `docs/decisions/adr-044-chatapp-coordinator-supersedes-orchestrator.md` — ChatApp coordinator supersedes FlowOrchestrator; hybrid snapshot + audit-log persistence; "external projection stays byte-stable as a derived view"; §5 OQ#3 = "unify the external projection wire" (the open question this hypothesis targets); 2026-05-28 amendment removed the connectivity/freeze region.
- `ui-state/lib/machines/chat-app/router.ts` — the live wire surface; one actor per principal via `ChatAppActorRegistry`; `POST /begin|/event|/open-deep-link`, `GET /projection|/projection/stream`; identity = `X-User-Id`; single factory `buildChatAppRouter(runtime, wireMachine)` mounted under 5 wire paths; writes all target the same per-principal actor.
- `ui-state/lib/machines/chat-app/projection/derive-projection.ts` — pure `deriveProjection(snapshot, wireMachineName, bookkeeping) → FlowProjection`, byte-identical to the legacy log-fold; child.value→state via explicit per-machine maps; `flow_id` synthesized `${wireMachineName}:${principal_id}`; WIRE_TO_CHILD alias resolution.
- `ui-state/lib/machines/chat-app/snapshot.ts` + `ui-state/lib/persistence/chatapp-snapshot-store.ts` — hybrid persistence; `getPersistedSnapshot()` is state-of-record (one Redis record per principal); `isSettledForSnapshot` (R3) blocks persisting mid-invoke; `rehydrateChatApp` via `createActor({snapshot}).start()`; snapshot is opaque, FE projection never derived from it.

## Research Metadata

Duration: ~1 session | Web pages examined: 11 fetched + 2 searches | Web sources cited: 14 | In-repo files read+cited: 8 (3 source + 5 ADR) | Cross-refs: every Finding ≥2 sources except F1/F2/F9 (single authoritative primary, noted) | Confidence: High 86%, Medium 14% | Output: docs/research/xstate-react-backend-integration.md | Tool failures: none (Idempotency-Key draft fetched as expired revision — recorded in Gap 3, not a failure).
