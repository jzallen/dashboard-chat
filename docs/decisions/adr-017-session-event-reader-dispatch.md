# ADR-017: SessionEventReader dispatch — Redis-default, Stream.io-optional

**Status:** Ratified
**Date:** 2026-05-01
**Originating wave:** Phase 2 DESIGN — Epic F (multi-replica readiness)
**Bead:** `dc-qj9.1.2` (F.2 — Stream.io adapter through Python backend)

## Context

`backend/app/use_cases/session/event_replay.py` defines a `SessionEventReader`
Protocol whose production default has been `_NoopSessionEventReader` since
Phase 1 C.2 (`dc-x3y.3.2`) shipped the read endpoint. The placeholder ships a
contract-compliant empty page and emits a one-time WARNING on first use
(`dc-c7l`) so misconfigured deployments are detectable. The agent side mirrors
the shape: `agent/lib/chat/handleChat.ts` defaults to `noopThreadPersister`.

Two facts force a decision now:

1. The read-endpoint contract (`GET /api/sessions/{id}/events`) is live and
   downstream features (F.3 presentation-state shared store, G.1 demo
   workload, G.2 replay-+-idempotency e2e) need a real backing store.
2. Stream.io credentials are not yet wired through the Python backend's env,
   and the dev compose stack runs without a Stream.io account at all. We need
   a backing store that works with `docker compose up -d` from a clean
   checkout (the F.2 acceptance gate) **and** is forward-compatible with the
   eventual Stream.io target.

## Decision drivers

- **Compose-runnable parity.** ADR-016 codified that the test compose stack
  must mirror production topology so what we test is what runs. Same logic
  applies here: dev compose has to write and read events through the same
  contract production uses, even when Stream.io is absent.
- **Capability presence, not environment name.** Branching on
  `NODE_ENV === "production"` (or `ENV`, `APP_ENV`, etc.) couples adapter
  selection to a label rather than to whether the dependency is actually
  configured. The label can be wrong (a dev cluster pretending to be prod, a
  prod replica with a missing env var); the capability check cannot.
- **Forward-compatibility with Stream.io.** The bead description in C.1
  identified Stream.io as the eventual durable store; we should not foreclose
  that path while we add a Redis backing store for the absent-Stream.io case.
- **Replay-scope domain events are write-once / read-many.** Both Redis
  Streams and Stream.io threads are append-only ordered logs with opaque
  cursors. The Protocol fits both without contortion.

## Considered options

1. **Branch on `NODE_ENV` / `ENV`.** Production → Stream.io adapter; non-prod
   → in-memory or noop. Simple, but couples adapter selection to a label
   independent of whether the dependency is actually wired in. Rejected
   explicitly below.
2. **Stream.io-only with a fake in tests.** Skip Redis entirely; mock
   Stream.io for compose dev. Rejected because the dev stack would then run
   logic that doesn't match what production-without-Stream.io runs (and "prod
   without Stream.io" is a real configuration — see driver above).
3. **Redis-default with Stream.io-optional, capability-presence dispatch.**
   Selected. Both adapters land; a startup helper picks one based on which
   env var is present. Compose dev runs the Redis path byte-identically to
   prod-without-Stream.io.

## Decision outcome

### Dispatch policy (capability-presence keyed)

At process startup, the `SessionEventReader` is selected by checking which
capability env var is set, in this order:

| Tier | Trigger                                   | Reader                         |
| ---- | ----------------------------------------- | ------------------------------ |
| 1    | `STREAM_API_KEY` AND `STREAM_API_SECRET` set | `StreamIoSessionEventReader`   |
| 2    | `REDIS_URL` set                           | `RedisSessionEventReader`      |
| 3    | neither set                               | `_NoopSessionEventReader`      |

> **Naming note.** The bead description (`dc-qj9.1.2`) used the informal name
> `STREAM_IO_API_KEY` for the gating capability variable. The repo's existing
> Stream.io config (`backend/app/config.py:stream_api_key`) reads from
> `STREAM_API_KEY`; this ADR adopts the existing project convention rather
> than introduce a parallel variable. The agent side mirrors this in
> `agent/lib/chat/streamPersister.ts` (deferred leaf).

The chosen reader is logged exactly once per process at INFO. The noop
fallback continues to emit the existing one-time WARNING on first use
(`dc-c7l`) — a deployment that misses both env vars is louder than a deploy
that explicitly configured the noop.

The TS-side wiring uses the same shape: `RedisThreadPersister` is selected
when `REDIS_URL` is set; `noopThreadPersister` otherwise. (No
`StreamIoThreadPersister` in this leaf — the agent side does not write
through Stream.io's hosted-thread API yet; persisting to Stream.io will be a
separate leaf when the SDK is wired through `agent/`.)

### Prohibited: NODE_ENV / ENV-keyed dispatch

`NODE_ENV`, `ENV`, `APP_ENV`, and friends MUST NOT be used to gate adapter
selection. The presence of the capability's connection variable is the
single source of truth. Reviewers should reject PRs that re-introduce
env-name-based branching for SessionEventReader / ThreadPersister selection.

### Cursor and idempotent-write contract (F.2 + F.3)

Both adapters honor the same Protocol-level contract documented at
`backend/app/use_cases/session/event_replay.py:64-69`:

- **Cursor opacity.** Cursors are opaque strings. Callers MUST treat them as
  bytes and pass them back unchanged. Redis Streams: the cursor is a Redis
  stream entry id (e.g., `1735689600000-0`). Stream.io: the cursor is a
  Stream.io message id.
- **"Strictly after" semantics.** `since=<cursor>` returns events strictly
  *after* the event identified by cursor. The boundary is pinned by tests on
  both adapters (`tests/use_cases/session/test_redis_session_event_reader.py`,
  + Stream.io integration test gated by `STREAM_API_KEY`).
- **Page completeness.** `next_cursor=None` means no more events exist
  *as of the read*. Subsequent appends are visible on the next call.
- **Idempotent writes.** Both stores are append-only; a re-delivered
  persist call MUST NOT corrupt prior entries. Redis Streams append is
  inherently append-only (XADD); the persister generates entry ids
  server-side rather than minting them client-side, so retries from a
  partial network failure result in a duplicated entry, not a corrupted log.
  Replay consumers downstream (F.3 / G.2) tolerate duplicates by event id;
  duplicate suppression is *not* the persister's responsibility.

The Protocol stays unchanged from Phase 1; this ADR codifies the previously-
implicit assumptions so F.3, G.1, G.2 can build on them without re-deriving.

## Consequences

### Positive

- Compose dev runs the same code path as prod-without-Stream.io (closes the
  gap ADR-016 opened for auth-proxy, this time for the event log).
- Adapter selection is deployment-config-independent: missing an env var
  produces the noop with a loud warning, never silent breakage.
- F.3 (presentation-state shared store) inherits a working Redis dependency
  and the cursor-opacity contract, so it can reuse the same Redis client
  factory and stream-key naming convention.

### Negative

- Two adapters to maintain (Redis + Stream.io). Test surface area roughly
  doubles for the read path. Mitigated by the Stream.io path being an
  integration-test-only suite gated on the env var.
- The Stream.io adapter exists in the codebase before its TS-side writer
  partner does. It is dead code in any environment without
  `STREAM_API_KEY` set, but selecting it without the matching writer
  would be observably broken (no events would be written). Mitigated by
  documenting the asymmetry in `event_replay_dispatch.py` and the adapter
  module docstring; followed up with a separate leaf (out of scope here)
  to wire the agent-side Stream.io persister.

### Operational

- `REDIS_URL` becomes a soft-required env var for any deployment that wants
  durable replay without Stream.io. The dev compose adds `redis:7-alpine`
  with a healthcheck and persistent volume; the agent and api services pick
  up `REDIS_URL=redis://redis:6379/0` by default.
- The noop fallback's existing WARNING is the only signal an operator gets
  if both env vars are unset. Acceptable for now; an alert-on-warning
  policy at the log aggregator layer would catch silent regressions.

## References

- `dc-qj9.1.2` (this leaf) — F.2 implementation
- `dc-x3y.3.1` / `dc-x3y.3.2` — Phase 1 read-endpoint + persister Protocol
- `dc-c7l` — Phase 1 patch adding the noop WARNING
- ADR-014 — DomainEvent stratification
- ADR-015 — cross-decision composition with the UIDirective log
- ADR-016 — same compose-parity reasoning applied to auth-proxy
