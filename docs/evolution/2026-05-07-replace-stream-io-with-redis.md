# Replace Stream.io with Redis on the SessionEventReader — Evolution

> **Feature**: replace-stream-io-with-redis
> **Finalized**: 2026-05-07
> **Epic**: `dc-29v` (4 phases — `dc-1ng`, `dc-5u9`, `dc-nou`, `dc-5sf`)
> **Research input**: [`docs/research/2026-05-07-stream-io-vs-redis-session-events.md`](../research/2026-05-07-stream-io-vs-redis-session-events.md)
> **Original design**: `docs/feature/replace-stream-io-with-redis/design/design.md` at commit `f9465a8` — preserved in git history; not re-archived here because the design landed verbatim across the four phases.
> **Supersedes**: [ADR-017 — SessionEventReader dispatch (Redis-default, Stream.io-optional)](../decisions/adr-017-session-event-reader-dispatch.md)
> **Ratifies**: [ADR-018 — Redis-only SessionEventReader](../decisions/adr-018-redis-only-session-event-reader.md)

## Summary

Deleted the Stream.io tier from `SessionEventReader` dispatch. Redis is now the only durable adapter; the noop fallback is unchanged. The `SessionEventReader` Protocol — the abstraction the team wanted to keep — is preserved verbatim; what shipped is a simpler dispatch table behind it.

The migration was **delete + drop env vars**, not data movement: zero production traffic ever flowed through the Stream.io path because the agent-side `StreamIoThreadPersister` was never built. The forward-compatibility hedge ADR-017 codified went unused.

## Why supersede ADR-017

Six months of operational signal forced the decision:

- **Zero data through the Stream.io tier.** No deployment ever set `STREAM_API_KEY` + `STREAM_API_SECRET` together. Tier 1 of the dispatch table was dead in practice.
- **Broken on first real exercise.** When the Stream.io reader was actually exercised (Mayor session 2026-05-07, `GetOrCreateChannel` bug), its cursor handling did not match Stream.io's message-id semantics. Fixing it would have cost more than deleting it.
- **Asymmetric writers.** ADR-017 §Consequences/Negative explicitly flagged "selecting Stream.io without the matching writer would be observably broken." The matching writer was never wired through the agent. The hedge was structurally half-built from the start.
- **Operator load.** Two adapters and two env-var sets in the mental model for a path no one used.

ADR-018 keeps everything from ADR-017 that did its job:

- Capability-presence dispatch (`REDIS_URL` set → Redis; unset → noop).
- The Forbidden clause: NODE_ENV / ENV / APP_ENV MUST NOT gate adapter selection.
- The Protocol contract (cursor opacity, strictly-after semantics, page completeness, idempotent writes).

What's gone: the Stream.io tier, the `StreamIoSessionEventReader` adapter, the `stream_token` router, and the three `Settings` fields (`stream_api_key`, `stream_api_secret`, `stream_io_channel_type`).

## Final shipped state

### Backend

- `backend/app/use_cases/session/event_replay_dispatch.py` — dispatch helper now picks `RedisSessionEventReader` if `REDIS_URL` is set, else `_NoopSessionEventReader`. The Stream.io branch is gone.
- `backend/app/use_cases/session/stream_io_session_event_reader.py` — deleted.
- `backend/app/routers/stream_token.py` — deleted (`POST /api/sessions/{id}/stream-token` no longer exists). The frontend already tolerated its 503 by rendering chat un-wrapped (`StreamProvider.tsx`); deletion is observable as a 404 instead of a 503, with no behavior change downstream.
- `backend/app/config.py` — `Settings.stream_api_key`, `stream_api_secret`, `stream_io_channel_type` removed. Pydantic ignores unknown env vars by default, so leftover `STREAM_API_KEY=...` in operator `.env` files is silently dropped — no startup crash.
- `backend/pyproject.toml` / `backend/uv.lock` — `stream-chat>=4.18.0` removed.
- `backend/BUILD.bazel` — `stream_chat` dep removed from the relevant py_library targets.
- Test surface — the Stream.io adapter's integration suite (gated by `STREAM_API_KEY`) is gone. The Redis live integration test (`test_session_event_replay_redis_live.py`) and the dispatch unit tests stay.

### Compose / dev

- `docker-compose.yml` — `STREAM_API_KEY` / `STREAM_API_SECRET` env passthroughs removed from the `api` and `agent` services. `redis:7-alpine` is unchanged.
- `tests/acceptance/log-image-identity-on-startup/steps/identity_steps.py:118` — the `env_path.write_text("STREAM_API_KEY=\n")` line was removed in Phase 3 because the gating env var is no longer read.

### Documentation

- ADR-017 header marked `Status: Superseded by ADR-018`. Body left intact — superseded ADRs preserve historical reasoning.
- ADR-018 ratified, citing operational evidence and preserving ADR-017's Forbidden: NODE_ENV clause.
- Comments in 17 code/test files were updated from "ADR-017" to "ADR-018 (supersedes ADR-017)" so reviewers reading current code reach the live decision first.

## Delivery path (epic `dc-29v`)

Four sequential phases, one bead per phase. Phases 1 → 2 → 3 are linearly dependent (each phase removes the surface the next would otherwise still touch). Phase 4 ships last so the ADR reflects what actually landed.

| Bead | Title | Outcome | Commit |
|---|---|---|---|
| `dc-1ng` | Phase 1 — Delete Stream.io adapter from SessionEventReader dispatch | ✓ Stream.io tier removed from dispatch; adapter deleted; tests pruned | `2ce5feb` (refactor) + `36f70a5` (deliver artifacts) |
| `dc-5u9` | Phase 2 — Remove Stream.io router + compose env vars | ✓ `stream_token.py` deleted; compose env passthroughs gone; `Settings` fields removed | `a4006f2` |
| `dc-nou` | Phase 3 — Remove Stream.io residue from acceptance tests | ✓ `STREAM_API_KEY=` line dropped from `log-image-identity-on-startup` env stub | `60765e5` |
| `dc-5sf` | Phase 4 — ADR-017 → ADR-018 + finalize (this doc) | ✓ ADR-018 ratified, ADR-017 superseded, code-comment grep-and-replace, this evolution doc | `401cc56` (ADR + comments) + this commit (finalize) |

## Restoring Stream.io if it's ever wanted back

The deletion was clean enough to make this mechanical:

1. `git show <Phase-1-SHA>:backend/app/use_cases/session/stream_io_session_event_reader.py > backend/app/use_cases/session/stream_io_session_event_reader.py` (and equivalent for its tests).
2. Re-add the Tier 1 branch in `event_replay_dispatch.py`.
3. Re-add `stream_api_key` / `stream_api_secret` (and optionally `stream_io_channel_type`) to `Settings`.
4. Re-add `stream-chat` to `backend/pyproject.toml` and re-lock.
5. Wire the (still-unbuilt) agent-side `StreamIoThreadPersister` — the actual asymmetry that made ADR-017's hedge unworkable. **Without this step, restoring the reader puts the codebase back in the half-built state ADR-018 exited.**

The `SessionEventReader` Protocol is unchanged across ADR-017 → ADR-018, so re-introduction is purely additive on the read side.

## Out of scope (still)

- **Frontend chat UI's dependency on `stream-chat` and `stream-chat-react`.** Research §2.D — separate, much larger epic. ADR-018 narrowly addresses the backend `SessionEventReader` and the agent-side persister. The frontend's hosted-thread/channel UI continues to use Stream.io until that epic is opened.
- **Reverting any code from Phases 1–3.** All shipped per the design.
- **Editing the historical ADR-017 body.** Only the header status line changed.

## References

- ADR-014 — DomainEvent stratification
- ADR-015 — cross-decision composition with the UIDirective log
- ADR-016 — same compose-parity reasoning applied to auth-proxy
- ADR-017 — superseded predecessor
- ADR-018 — ratified successor
- Research: `docs/research/2026-05-07-stream-io-vs-redis-session-events.md`
