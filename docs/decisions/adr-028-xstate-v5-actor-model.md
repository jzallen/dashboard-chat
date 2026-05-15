# ADR-028: XState v5 with the Actor Model as the UI-State Engine

**Status:** Accepted (ratified 2026-05-11; amended 2026-05-15 — see "Amendment 2026-05-15" below)
**Date:** 2026-05-11
**Originating wave:** DESIGN — `user-flow-state-machines`
**Companion artifacts:**
- DISCUSS handoff: `docs/feature/user-flow-state-machines/discuss/handoff-design.md` (OQ-2 deferred)
- DESIGN application-architecture: `docs/feature/user-flow-state-machines/design/application-architecture.md`
- Sibling ADRs: ADR-027 (ui-state tier + framework), ADR-029 (`active_scope` propagation contract), ADR-030 (orchestrator topology — amended in lockstep 2026-05-15)
- Divergence artifact that motivated this amendment: `docs/discussion/session-chat-context-architecture/directions.md` (Direction A + Direction F convergence)

## Context

The DISCUSS wave committed to XState as a building block but did not resolve which version or which API surface. Two architecturally consequential variants exist:

- **XState v4** — the long-stable major; well-known idioms; cross-machine coordination is hand-rolled (typically via a shared service or imperative `interpret().send()` calls between machines).
- **XState v5** — current major (since 2024); introduces the **actor model** as a first-class API: machines spawn child actors; parents `send` events to children; a `system` view enumerates spawned actors; `inspect()` provides built-in observability.

US-005 has a load-bearing requirement: on `expired_token`, **all other flow machines freeze their mutations** until silent re-auth completes. This is cross-machine coordination — exactly the shape XState v5's actor model is designed for, and exactly the shape XState v4 leaves as a hand-rolled concern.

## Decision drivers

- **US-005 cross-machine freeze semantics.** The freeze signal must reach every active flow actor atomically. Hand-rolled coordination across N machines (the v4 idiom) is the canonical race-condition surface.
- **Replay buffer ownership.** The replay buffer (5s timeout, 16 max queued mutations) belongs in the orchestrator, not scattered per-machine. v5's actor model gives the orchestrator a natural place to own this.
- **Observability.** v5's `inspect()` produces a structured event stream of actor lifecycle events suitable for piping into our existing correlation-id-threaded logs.
- **TypeScript inference.** v5 has materially improved TypeScript inference; type-level safety on machine transitions reduces a class of runtime drift.
- **Maturity vs cutting edge.** v5 has been GA since 2024; ecosystem (devtools, inspector, examples) has caught up. v4 is in maintenance.
- **Reversibility.** If v5's API stabilizes adversely, v5 → v4 downgrade is mechanical (one machine at a time); reverse is not.

## Considered options

1. **XState v4 (statecharts only).** Mature; familiar; cross-machine coordination is hand-rolled via interpreted services and imperative `send` calls.
2. **XState v5 (statecharts only — no actor model).** Use v5 syntax but treat each machine as a standalone interpreter. Cross-machine coordination still hand-rolled.
3. **XState v5 with actor model (recommended).** Use `setup({ actors: {...} }).createMachine(...)` + `spawnChild` + `sendTo` patterns. Orchestrator actor owns the actor tree.
4. **Anything-stately Studio integration.** Visual statechart editor with code generation. Not chosen — adds tooling dependency for a single-developer-can-write-by-hand artifact; revisit if statecharts grow beyond ~10 named states per flow.
5. **Hand-rolled reducer (rejected at DISCUSS commit time).** Not under consideration — DISCUSS already committed to XState.

## Decision outcome

**XState v5 with the actor model.**

Concretely:

- **One root orchestrator actor** per process: spawned at composition-root in the ui-state tier. Owns the actor tree.
- **Per-flow actors** spawned by the orchestrator as flows are activated for a session: `LoginAndOrgSetupMachine`, `ProjectSessionMachine` (J-002, future), `TransformMachine` (J-005, future), etc.
- **Cross-machine signaling**: orchestrator listens for `token_expired` events from `LoginAndOrgSetupMachine`; broadcasts `FREEZE` to all other spawned children via `system.get(<actor_id>).send({ type: 'FREEZE' })`. On `THAW`, same broadcast.
- **Replay buffer** is a property of the orchestrator (NOT of any machine). It captures intent events that arrive at child actors during the freeze window and re-sends them on THAW.
- **Persistence**: machine context is rebuilt from the Redis flow-event log on cold restart (event-sourced); the actor tree is rehydrated from the most recent event per flow. The actor identity is `(flow_id, principal_id)` so a restarted tier picks up where the previous instance left off.
- **No machine imports another machine.** Machines communicate via the orchestrator. This is the dependency-inversion boundary; without it, the actor tree becomes an implicit dependency graph.

### Library version pin

`xstate@^5.0.0` — pin to the latest stable v5 at MR-1 kickoff. Update via standard dependency-bump cadence; major-version bumps (to v6 hypothetical) require a follow-up ADR.

### TypeScript integration

`setup` API + typed events + `assign` + `provide` for adapter injection at test time:

```ts
// ui-state/lib/machines/loginAndOrgSetup.ts
export const loginAndOrgSetupMachine = setup({
  types: {
    context: {} as LoginContext,
    events: {} as LoginEvent,
  },
  actors: {
    verifyJwt: fromPromise(({ input }) => /* ... */),
    createOrg: fromPromise(({ input }) => /* ... */),
  },
}).createMachine({
  id: 'login-and-org-setup',
  initial: 'anonymous',
  states: {
    anonymous: { /* ... */ },
    authenticating: { invoke: { src: 'verifyJwt', /* ... */ } },
    // ...
  },
});
```

Tests inject mock actors via `.provide({ actors: { verifyJwt: fromPromise(/* mock */) } })` — preserves dependency-inversion at the actor boundary.

### Mapping to existing ADRs

| ADR | Mapping |
|---|---|
| ADR-014 (ChatEvent stratification) | Machine transitions emit `DomainEvent`s; `FREEZE`/`THAW` are `DomainEvent`s, not `UiDirective`s. Projection emits `UiDirective`s (via projection-build helpers) when the FE needs to render a state change. |
| ADR-015 (presentation-state log) | The flow-event log is the parallel concept; the projection is the read shape. |
| ADR-018 (capability-presence dispatch) | The actor's `invoke` calls hit the same adapters that are capability-dispatched (Redis or noop). |

## Consequences

### Positive

- Cross-machine freeze (US-005) is a 5-line `system.get(...).send(...)` loop, not a hand-rolled pub/sub.
- The orchestrator has a natural place to own the replay buffer.
- TypeScript inference catches a class of transition bugs at compile time.
- `inspect()` plugs into the existing `correlation_id`-threaded log pipeline with one helper.
- Test isolation: each machine is testable via `.provide({ actors: { ... } })` injection — pure unit tests, no Redis.

### Negative / accepted trade-offs

- **Learning curve**: the team's current XState exposure is zero (no `xstate` import exists in the repo today). The v5 actor model is a non-trivial first encounter. Mitigation: ship US-001 as the seed; one machine, one orchestrator, one freeze test — review-gates the pattern before US-002 lands.
- **`v5` maturity vs ecosystem inertia**: most XState examples online are v4. Mitigation: maintain a `ui-state/docs/xstate-v5-cookbook.md` with our chosen idioms; v5 docs are official and complete.
- **Lock-in to v5 actor-model API surface**: if v5's actor API changes between minor versions, our orchestrator may need to adjust. Mitigation: pin major version; review the changelog at each minor bump; the actor-model API is the most-used surface of v5 and stable in practice.

## Amendment 2026-05-15 — Machines own transitions; the log owns state

**Status:** Accepted (2026-05-15)
**Wave:** DESIGN — ratification of `docs/discussion/session-chat-context-architecture/directions.md` Direction A + Direction F convergence.
**Resolves:** the "god context" pressure on `SessionChatMachineContext` and `ProjectContextMachineContext` (16 fields apiece, inline comments documenting which states populate which — comments substituting for type safety).

### What changed

The original §"Decision outcome" said *"machines own state"* (implicit in the bullet on persistence: "machine context is rebuilt from the Redis flow-event log on cold restart"). The wave-decisions amendment (DWD-9, J-002 design) elevated the log to **SSOT**: "the projection is rebuilt from the log; the snapshot is a cache." This amendment makes that elevation load-bearing for the **machine context shape**, not just for cold-restart rehydration.

The revised letter is:

> **Machines own transitions; the log owns state.**

Concretely:

- A machine's `context` carries **internal handler state only** — values that the machine needs to make its own transition decisions in the immediate next step. The canonical members are `correlation_id`, `principal_id`, and any literal continuation pointers needed mid-invoke that cannot be carried via `event.output` (see ADR-030 §"Amendment 2026-05-15 — Async-invoke continuations via `event.output` (Direction F)").
- A machine's `context` does **NOT** carry data destined for downstream consumers (the orchestrator's FlowEvent emission, the projection reducer, the FE). Those consumers read from the **projection** (ADR-030 §"Amendment 2026-05-15 — Projection as primary read model"), which is built from the log.
- The "no machine imports another machine" invariant (original §"Decision outcome") is **unchanged**. This amendment does not introduce machine-to-machine coupling. The orchestrator remains the only cross-machine mediator, and the log/projection remain the only cross-machine read surface.

### Ubiquitous-language anchor — the discriminating test

The vocabulary the team will use to reason about every new context field, verbatim from the convergence discussion:

> "The context seems like internal state for an event handler whereas `event.output` communicates: these are the variables I want other states to have if they occur after me."

This sentence is the **discriminating test** every new `context` field PR must pass before review:

> *Is this internal handler state, or is it a contract between states?*

- **Internal handler state** → may live in `context`. Examples: a retry counter the machine itself reads inside an `error_recoverable` guard; a pre-invoke configuration value the invoke needs as `input`; the machine's own `correlation_id` for log threading.
- **Contract between states** → MUST NOT live in `context`. It belongs in a `DomainEvent` written to the log (read back by the next state via the projection) or in `event.output` (handed off across an async-invoke boundary per ADR-030 amendment).

PR reviewers (human and agent) MUST apply this test explicitly. A new `context` field whose only readers are *other states* of the same machine, *the orchestrator*, *the projection reducer*, or *downstream FlowEvent emission* fails the test and is refused review.

### What this amendment does NOT change

- **The "no machine imports another machine" invariant** (original §"Decision outcome", bullet 7) — unchanged. Direction B in the divergence artifact (aggregate-per-cluster) would have amended this; A+F do not.
- **The actor-model commitment** (§"Decision outcome" bullets 1-4) — unchanged. Orchestrator, per-flow actors, cross-machine signaling via `system.get(...)` all remain.
- **The replay buffer's location** (orchestrator-owned) — unchanged.
- **The `setup` API + typed events + `assign` + `provide` idiom** (§"TypeScript integration") — unchanged. What's narrowed is the *shape* of context, not the API for managing it.
- **Cold-restart rehydration via Redis flow-event log** (§"Decision outcome", bullet 6) — unchanged. If anything, this amendment reinforces it: shrinking the context to internal-handler-state means rehydration has less to reconstruct and the projection's role as authoritative read model is more visible.

### Migration

The mechanical migration (drop fields from machine contexts; redirect their readers to the projection) is sequenced in ADR-030's amendment §"Migration sequencing". This amendment does not commit to a delivery date; the LEAF-1 branch `refactor/session-chat-context-srp` (which drops `intent_resource_id` + `intent_resource_type` from `SessionChatMachineContext`) is consistent with Direction F and lands independently of this ratification.

### Enforcement (Earned Trust)

Per principle 12 ("every architectural style choice includes a recommendation for language-appropriate automated enforcement tooling"), the discriminating test is reinforced by the snapshot-read prohibition in ADR-030 §"Amendment 2026-05-15 — Projection as primary read model". An ESLint custom rule (or `eslint-plugin-boundaries`-style import-graph constraint) is the recommended enforcement vehicle; specifics live in that amendment because the rule's *subject* is the orchestrator's read sites, not the machine definitions themselves.

## Open questions

1. **`createActor` vs `interpret` (v4 name)**: v5 renamed `interpret` to `createActor`. Confirmed; no decision needed.

2. **State persistence shape**: v5's `getPersistedSnapshot` API supports serializing actor state. We use it ONLY for hot-restart resumption; the canonical SSOT remains the Redis event log (event-sourced). This is documented in ADR-027 §1.

3. **Inspector integration in production**: v5's `inspect` can stream to a devtools instance. For dev: enabled. For production: disabled by default (env-flag-gated) — sensitive event payloads should not leak to a hosted inspector without explicit opt-in.

## References

- XState v5 docs: <https://stately.ai/docs>
- Actor model in v5: <https://stately.ai/docs/actors>
- DISCUSS OQ-2: `docs/feature/user-flow-state-machines/discuss/handoff-design.md`
