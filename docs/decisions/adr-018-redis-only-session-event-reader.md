# ADR-018: Redis-only SessionEventReader

**Status:** Ratified
**Date:** 2026-05-07
**Originating wave:** DESIGN — replace-stream-io-with-redis
**Supersedes:** ADR-017
**Bead:** `dc-29v` (epic) → `dc-1ng`, `dc-5u9`, `dc-nou`, `dc-5sf` (Phases 1–4)

## Context

ADR-017 picked Redis-default with Stream.io-optional as a forward-compatibility
hedge: Tier 1 dispatched to `StreamIoSessionEventReader` when both
`STREAM_API_KEY` and `STREAM_API_SECRET` were set; Tier 2 dispatched to
`RedisSessionEventReader` when `REDIS_URL` was set; Tier 3 fell back to the
noop. The hedge bought us optional durability through Stream.io's hosted
threads without committing the agent-side writer up front.

Six months in, none of that hedge paid off:

- Zero data has ever flowed through the Stream.io read path. No deployment set
  the Stream.io tier env vars; the Tier 1 branch was dead in practice.
- The `StreamIoSessionEventReader` was broken on first real exercise — its
  cursor handling never matched Stream.io's actual message-id semantics, but
  no production traffic surfaced the bug.
- The agent-side `StreamIoThreadPersister` was never implemented. With no
  writer, the reader had nothing to read; "select Stream.io without the matching
  writer would be observably broken" (ADR-017 §Consequences/Negative) was the
  inevitable outcome of the hedge being half-built.
- Operators carried the cognitive load of two adapters and two env-var sets
  for a path no one used.

The forward compatibility we paid for went unused. The cost (test surface
area, documentation, dead code, lock-file weight from `stream-chat`) was real.

## Decision

**Delete the Stream.io adapter.** Keep ADR-017's capability-presence dispatch
policy and Redis-as-default outcome — those continue to apply to the Redis
tier and the noop fallback. Drop the Stream.io tier from the dispatch helper,
delete `StreamIoSessionEventReader`, delete the `stream_token` router, and
remove `stream_api_key` / `stream_api_secret` / `stream_io_channel_type` from
`Settings`.

The new dispatch table:

| Tier | Trigger        | Reader                         |
| ---- | -------------- | ------------------------------ |
| 1    | `REDIS_URL` set | `RedisSessionEventReader`      |
| 2    | unset          | `_NoopSessionEventReader`      |

The agent-side `ThreadEventPersister` shape is unchanged: `RedisThreadPersister`
when `REDIS_URL` is set, `noopThreadPersister` otherwise. The agent-side
Stream.io persister was never built; nothing to delete there.

## Consequences

### Positive

- Compose dev runs the same code in dev as in prod (already true under
  ADR-017; trivially so now that there is only one durable tier).
- One fewer external service in the operator's mental model. The
  Stream.io-account question no longer factors into deployment planning for
  the event-reader path.
- Smaller test surface: the Stream.io integration suite gated by
  `STREAM_API_KEY` is gone along with the adapter. Phase 3 also drops the
  `STREAM_API_KEY=` line from the acceptance-test `.env` stub, since it is
  now ignored.
- Pydantic settings ignore unknown env vars, so leftover `STREAM_API_KEY=...`
  lines in operator `.env` files are silently ignored — no startup crash on
  upgrade.

### Negative

- If Stream.io is wanted back, the adapter has to be restored from git
  history. The Phase 1 deletion commit (Phase 1 SHA in
  `dc-1ng`) carries the full prior `StreamIoSessionEventReader` body and
  test suite; restoring is a `git show <sha>:path > path` per file plus
  re-adding the dispatch tier and env vars to `config.py`. The Protocol
  contract is unchanged, so re-introduction is purely additive.

### Operational

- `REDIS_URL` becomes the only durable-replay capability variable. Any
  deployment that wants persistent session events sets it; absence picks the
  noop with the same one-time WARNING shipped in `dc-c7l`.
- The `stream_token` router (`POST /api/sessions/{id}/stream-token`) is
  removed. No frontend path depended on it in dev; the prod frontend already
  tolerated the 503 it returned by rendering chat un-wrapped
  (`StreamProvider.tsx`).

## Forbidden (preserved from ADR-017)

`NODE_ENV`, `ENV`, `APP_ENV`, and friends MUST NOT be used to gate adapter
selection. The presence of the capability's connection variable
(`REDIS_URL`) is the single source of truth. Reviewers should reject PRs
that re-introduce env-name-based branching for `SessionEventReader` /
`ThreadEventPersister` selection. This was the central anti-pattern
ADR-017 codified, and removing the Stream.io tier does nothing to relax it.

## References

- ADR-017 — superseded predecessor; preserved for historical context
- ADR-014 — DomainEvent stratification
- ADR-015 — cross-decision composition with the UIDirective log
- ADR-016 — same compose-parity reasoning applied to auth-proxy
- `dc-29v` — epic bead (replace-stream-io-with-redis)
- `dc-1ng` — Phase 1 (delete adapter from dispatch)
- `dc-5u9` — Phase 2 (remove stream_token router + compose env vars)
- `dc-nou` — Phase 3 (acceptance test cleanup)
- `dc-5sf` — Phase 4 (this ADR + finalize)
- Design doc: archived to `docs/evolution/2026-05-07-replace-stream-io-with-redis.md`
