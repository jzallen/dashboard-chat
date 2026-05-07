# Stream.io vs Redis for the Session Event Reader

**Date:** 2026-05-07
**Author:** dave (crew, dashboard_chat)
**Audience:** Mayor (decision-maker)
**Status:** Research input — design lives in `docs/feature/replace-stream-io-with-redis/design/design.md`
**Scope decision (Mayor, 2026-05-07):** Eliminate the Stream.io path on the **session event replay**
surface. The frontend chat UI dependency on `stream-chat` / `stream-chat-react` is a separate
question, called out in §6 (Out of scope) and §7 (Open questions).

---

## 1. Context

`backend/app/use_cases/session/event_replay_dispatch.py:40` selects one of three
`SessionEventReader` adapters at process startup using capability-presence dispatch
(ADR-017):

1. `STREAM_API_KEY` AND `STREAM_API_SECRET` set → `StreamIoSessionEventReader`
2. `REDIS_URL` set → `RedisSessionEventReader`
3. neither → `_NoopSessionEventReader`

A bug in `StreamIoSessionEventReader.get_events` (Mayor session 2026-05-07) made the
Stream.io path return 500 in the dispatch acceptance test. Mayor worked around it by
removing the STREAM creds from `.env`, forcing the Redis path. This research backs
Mayor's intent to **delete the Stream.io path entirely** rather than fix the bug.

---

## 2. Inventory of Stream.io usage (file:line)

Inventory was produced by case-insensitive grep for the patterns
`stream[-_](io|chat|api)`, `stream_chat`, `StreamIo`, `STREAM_API_KEY`,
`STREAM_API_SECRET`, `VITE_STREAM` across `*.py *.ts *.tsx *.js *.jsx *.toml *.yml
*.yaml *.json *.md` (excluding `node_modules/` and `*.lock` files). 22 source files,
~100 hits total.

The hits cluster into **four functionally separate concerns**. Splitting them this way
matters because Mayor's task targets only concern (A); concerns (B) and (D) are large
enough to warrant their own decision.

### A. Backend SessionEventReader path — **in scope for this task**

| File | Lines | What it does |
|---|---|---|
| `backend/app/use_cases/session/stream_io_session_event_reader.py` | 1–110 | The adapter under deletion |
| `backend/app/use_cases/session/event_replay_dispatch.py` | 6, 24, 33, 37, 46–55, 73–74 | Tier-1 selector + builder |
| `backend/app/config.py` | 88, 89, 91 | `stream_api_key`, `stream_api_secret`, `stream_io_channel_type` settings |
| `backend/pyproject.toml` | 47 | `"stream-chat>=4.18.0"` Python SDK dep |
| `backend/tests/use_cases/session/test_stream_io_session_event_reader.py` | 1–150 (entire file) | Adapter unit tests |
| `backend/tests/use_cases/session/test_event_replay_dispatch.py` | 4, 27, 40, 51–88 | Tier-1 dispatch tests |
| `backend/tests/integration/dataset_layer/test_replay_idempotency.py` | 99–118 | Skip-condition mentions `STREAM_API_KEY+SECRET` as one acceptable path |
| `docker-compose.yml` | 116, 186–188, 240–241 | `STREAM_API_KEY`/`STREAM_API_SECRET` env passthrough on `agent` and `worker` services |
| `docs/decisions/adr-017-session-event-reader-dispatch.md` | 70, 77, 88, 111, 144 | ADR being superseded |
| `docs/evolution/2026-05-04-log-image-identity-on-startup.md` | (passing reference) | Mentions adapter selection only |
| `tests/acceptance/log-image-identity-on-startup/steps/identity_steps.py` | 118 | Writes `STREAM_API_KEY=` (empty) into a generated `.env` to deterministically force the Redis path during the acceptance test |

### B. Backend Stream.io JWT mint endpoint — **frontend-coupled, see §6**

`POST /api/stream/stream-token` (`backend/app/routers/stream_token.py:1–39`,
included in `backend/app/main.py:28,144`, listed in `backend/app/routers/__init__.py:12,27`,
tested at `backend/tests/integration/test_stream_token.py:1–70`). 39 lines. Mints a
Stream.io user JWT for the **frontend** chat client. The frontend calls it from
`StreamProvider.tsx:21`. Sole consumer is the frontend Stream.io chat UI; if (B) goes,
(D) goes with it (and vice versa).

### C. Agent (worker) side — **already Stream.io-free**

`agent/lib/chat/threadPersisterDispatch.ts:1–60` only knows `redis` and `noop`.
ADR-017 explicitly notes "No `StreamIoThreadPersister` in this leaf — the agent side
does not write through Stream.io's hosted-thread API yet". A grep of `agent/` for
`stream[-_](chat|io)|StreamChat` returned **zero** hits. **No agent-side work is
required for this migration.**

### D. Frontend chat UI dependency on `stream-chat` + `stream-chat-react` — **not in scope**

This is a much larger surface than (A). The frontend treats Stream.io as the live
chat backbone, not just a replay store:

| File | Lines | Role |
|---|---|---|
| `frontend/package.json` | 22, 23 | `stream-chat ^9.35.1`, `stream-chat-react ^13.14.1` deps |
| `frontend/src/stream-chat.d.ts` | 1–3 | Module-augmentation declarations |
| `frontend/src/lib/stream/StreamProvider.tsx` | 1–89 | Top-level `<Chat>` provider, JWT auth via `/api/stream/stream-token` |
| `frontend/src/lib/stream/useStreamClient.ts` | 1–9 | `useContext` access to the `StreamChat` instance |
| `frontend/src/lib/stream/useSessionContext.ts` | 1–81 | Channel create/resume/query — backbone of session navigation |
| `frontend/src/lib/stream/channelId.ts` | (helper) | Deterministic channel ids |
| `frontend/src/lib/stream/useEntityContext.ts`, `useSSEOverlay.ts` | (helpers) | Channel-scoped state |
| `frontend/src/ui/components/AppShell/index.tsx` | (consumer) | Mounts `StreamProvider` |
| `frontend/src/ui/components/TablePanel/OperationsLog.tsx` | 2, 24, 31, 37–141 | Reads `channel.state.messages`, subscribes to `message.new` for live tool-call display |
| `frontend/src/ui/context/ChatContext/hooks/useChatEngine.tsx` | 15, 29–30, 105, 114, 123, 200–326 | Core chat engine — uses `streamClient`, watches channels, hydrates messages from `channel.state.messages` |
| `frontend/src/ui/context/__tests__/ChatContextState.test.tsx`, `ChatContext.test.tsx`, `useChatEngine.test.tsx`, `OperationsLog.test.tsx`, `__tests__/useSessionContext.test.ts` | (tests) | All exercise Stream.io contracts |
| Build artefacts | `pnpm-lock.yaml` 154–7513, `package-lock.json` 137, 138, 1746, 11281, 11290 (transitive scope `@stream-io/*`) | Lockfile entries |

This is **entirely outside Mayor's stated scope** (the session event reader). It is
called out in §6 because it is structurally entangled with (B) — removing the Stream.io
JWT endpoint breaks `StreamProvider.tsx`, which breaks `useChatEngine.tsx`, which
breaks the chat UI. Migrating (A) does **not** touch (D).

### E. Documentation/changelog references — informational

- `CHANGELOG.md:208,210`
- `docs/decisions/adr-017-session-event-reader-dispatch.md` (entire file becomes
  superseded; see design doc §3.2 for ADR strategy)
- `docs/evolution/2026-05-04-log-image-identity-on-startup.md`

---

## 3. Feature inventory: what Stream.io provides vs. what we use

Stream.io ([getstream.io](https://getstream.io)) is a hosted chat-and-feeds platform.
Its product surface is large; we intersect with a small subset.

| Stream.io feature | Used by dashboard_chat? | Where |
|---|---|---|
| Channels with custom data (`orgId`, `projectId`, etc.) | **Yes (frontend D)** | `useSessionContext.ts:30–38` |
| `client.queryChannels` filtered by custom data | **Yes (frontend D)** | `useSessionContext.ts:62–71` |
| `channel.watch()` + `channel.state.messages` hydration | **Yes (frontend D)** | `useChatEngine.tsx:235–260, 305–326` |
| `channel.on("message.new")` realtime subscription | **Yes (frontend D)** | `OperationsLog.tsx:137–140` |
| Chat React UI components (`<Chat>` from `stream-chat-react`) | **Yes (frontend D)** | `StreamProvider.tsx:81` |
| User JWT auth | **Yes (frontend D)** | `backend/app/routers/stream_token.py` mints; `StreamProvider.tsx:19–29` consumes |
| Custom message fields (`event_payload`, `tool_calls.custom`) | **Yes** — replay reads them (A); UI reads `tool_calls` from them (D) | `stream_io_session_event_reader.py:40, 76`; `OperationsLog.tsx:48–54` |
| Backend-driven `channel(...).query(messages={id_gt, limit})` cursor pagination | **Yes (A — under deletion)** | `stream_io_session_event_reader.py:60–67` |
| Presence / typing indicators / read receipts / reactions / replies / threads (sub-thread parents) / push notifications / moderation / SDK in mobile clients | **No** | grep returned no hits |

**Summary for the session event reader (A):** the backend uses one Stream.io capability —
**read message backlog from a channel with cursor pagination via `id_gt`**. That is
exactly what `RedisSessionEventReader.get_events` already does with `XRANGE
key (cursor +`. There is **zero** read-side capability gap (§4).

**Summary for the wider chat UI (D):** Stream.io is providing channel discovery,
realtime websocket subscription, JWT-auth-against-hosted-service, and a React component
library. This is significant value, and any "delete Stream.io entirely" plan would have
to replace all of it — which is the §6 / §7 epic, not this one.

---

## 4. Existing Redis adapter capabilities + gaps

`RedisSessionEventReader` (`backend/app/use_cases/session/redis_session_event_reader.py:41–99`)
and its TS-side writer counterpart `RedisThreadPersister`
(`agent/lib/chat/redisThreadPersister.ts`) form a complete read/write pair.

### What Redis already does — for the SessionEventReader contract

| `SessionEventReader` Protocol requirement | Redis implementation | Stream.io implementation | Gap? |
|---|---|---|---|
| `get_events(thread_id, since, limit) → EventsPage` | ✅ `XRANGE key (since + count=limit+1` (line 65) | `channel.query(messages={id_gt: since, limit: limit+1})` | None |
| Strictly-after cursor semantics | ✅ Native (`(cursor` is exclusive in Redis) | Native (`id_gt` is exclusive) | None |
| `has_more` flag without second call | ✅ Reads `limit+1`, slices to `limit` | Same trick | None |
| Opaque cursor | ✅ Stream entry id (e.g. `1735689600000-0`) | Message id (e.g. `01HZQ...`) | None |
| `next_cursor=None` when tail consumed | ✅ Lines 96–97 | Lines 93–94 | None |
| Filter UI directives, only DomainEvents | ✅ Naturally — writer only `XADD`s DomainEvents | Same — writer only writes DomainEvents | None |
| Append-only durable log | ✅ Redis Streams | Stream.io thread | None |

### Gaps relative to Stream.io's broader capability set

- **Hosted multi-tenant durability.** Stream.io persists threads on its own
  infrastructure indefinitely. Redis Streams are local to whatever Redis instance you
  run; durability is whatever your Redis topology delivers (AOF, replicas, RDB).
  *Impact for replay:* low. Replay is a developer-affordance read, not a
  long-term archive — and ADR-017 already chose Redis as the production-Redis-or-noop
  default. There is no committed SLO that requires Stream.io's durability profile.
- **Bounded retention.** Stream.io retains messages on the channel forever (subject to
  account plan). The TS-side writer trims with `XADD MAXLEN ~ <cap>`
  (`redisThreadPersister.ts:40–46`, env `REDIS_STREAM_MAXLEN`); replay can hit gaps if
  trimming is aggressive. *Impact:* unbounded streams (default — `maxLen` undefined)
  match Stream.io's retention behavior. Operators who want trimming get it; operators
  who don't, don't.
- **Realtime push to other consumers.** Stream.io's channel can fan out to other
  subscribers (e.g. another browser tab) automatically. Redis Streams support this via
  pub/sub or `XREAD BLOCK`, but the current reader is poll-only — no consumer uses
  push from the replay surface today. *Impact:* none for replay; the live-update path
  for the chat UI is the (D) concern, which uses Stream.io's websocket fanout.
- **Message-id format.** Stream.io ids are CKID-style; Redis ids are `ms-seq`.
  Cursors are opaque per the Protocol contract, so format change is invisible to
  callers.

**Conclusion:** for the session event reader contract specifically, **the existing
Redis adapter has zero functional gaps**. The Tier-1 selection of Stream.io was a
forward-compatibility hedge (ADR-017 §"Decision drivers"), not a feature requirement.

---

## 5. Migration cost estimate

Files in scope (A): **11 files** total, of which 4 are pure deletions, 4 are
small edits, and 3 are doc/test updates.

| File | Change | Approx. LOC delta |
|---|---|---|
| `backend/app/use_cases/session/stream_io_session_event_reader.py` | **delete** | −110 |
| `backend/tests/use_cases/session/test_stream_io_session_event_reader.py` | **delete** | −150 |
| `backend/app/use_cases/session/event_replay_dispatch.py` | drop `stream_io` branch + `_build_stream_io` + `StreamChatAsync` import; collapse `ReaderKind` to `"redis" \| "noop"` | ~ −25 |
| `backend/tests/use_cases/session/test_event_replay_dispatch.py` | remove tier-1 tests; verify `redis` wins when `REDIS_URL` set, `noop` otherwise | ~ −35 |
| `backend/app/config.py` | remove `stream_api_key`, `stream_api_secret`, `stream_io_channel_type` (or keep as deprecated no-op for one release; design doc §4 picks) | ~ −3 |
| `backend/pyproject.toml` | remove `"stream-chat>=4.18.0"` | −1 |
| `docker-compose.yml` | remove `STREAM_API_KEY`/`STREAM_API_SECRET` from `agent` (~186–188) and `worker` (~240–241) service env, and reword the comment block at line 116 | ~ −6 |
| `backend/tests/integration/dataset_layer/test_replay_idempotency.py` | simplify skip-condition: only `REDIS_URL` (drop `or STREAM_API_KEY+SECRET`) | ~ −5 |
| `tests/acceptance/log-image-identity-on-startup/steps/identity_steps.py` | drop the `STREAM_API_KEY=` line at 118 (no longer needed to force a path that no longer exists) | −1 |
| `docs/decisions/adr-017-session-event-reader-dispatch.md` | superseded; design doc §3.2 specifies whether to mark `Status: Superseded by ADR-018` and write a new ADR, or to amend in place | (no LOC) |
| `docs/decisions/adr-018-*` (new) | new ADR justifying deletion | ~ +60 |

Net: ~ **−270 LOC** of code/tests deleted, ~+60 LOC of new ADR. Roughly **2–4 hours of
focused work** for a single polecat (Outside-In TDD: dispatch test first, then deletions).

If Mayor also wants to close out (B) (the `/api/stream/stream-token` endpoint) **without**
touching the frontend (D), that is **not coherent** — the endpoint exists solely for
(D), and (D) breaks at runtime when the endpoint returns 503. So either:

- (A) only (this estimate), and (B)+(D) live another day; or
- (A) + (B) + (D) as a separate, larger epic (estimated ≫ 1 day).

---

## 6. Risks

1. **Hosted-data migration risk: none.** No production Stream.io account is currently
   wired through the Python backend — `STREAM_API_KEY` is empty in `.env`, dispatch
   never picks Tier-1, and no agent-side writer ever wrote DomainEvents to Stream.io
   anyway (ADR-017 explicitly defers `StreamIoThreadPersister`). There is **no data
   in Stream.io** to migrate. The "live integration test" referenced at
   `test_stream_io_session_event_reader.py:8`
   (`tests/integration/test_stream_io_session_event_reader_live.py`) **does not exist
   in the repo** — confirmed by `find backend/tests -name "test_stream_io*"`.
2. **Frontend-coupling risk: contained, but real.** The frontend chat UI (D) uses a
   **different** Stream.io surface (channels, websockets, React UI) and is unaffected
   by the deletion of the session event reader. However, the `STREAM_API_KEY` and
   `STREAM_API_SECRET` env vars are also consumed by the `stream_token.py` router,
   which mints user JWTs for the frontend. Removing the env vars from compose without
   also removing the router would leave the router shipping 503s — fine, but worth
   flagging. The design doc §3 keeps (B) untouched in the migration scope.
3. **ADR-017 supersession risk: low.** ADR-017's central rationale ("Redis-default,
   Stream.io-optional, capability-presence dispatch") is *partially* preserved: we
   keep capability-presence dispatch and Redis-default; we drop the Stream.io tier
   that was a forward-compatibility hedge. The new ADR documents this delta.
4. **Acceptance-test brittleness risk: low.** One acceptance step
   (`tests/acceptance/log-image-identity-on-startup/steps/identity_steps.py:118`)
   writes `STREAM_API_KEY=` (empty) into a generated `.env` to force the Redis path.
   After deletion that line is dead but harmless; better to delete it for hygiene.
5. **Reintroducing Stream.io later costs more.** If a future feature genuinely needs a
   hosted ordered log (e.g. cross-device sync without standing up a Redis-replicated
   store), reintroducing the Tier-1 Stream.io adapter requires reverting the deletion
   (or re-deriving from git history). Given (a) the existing implementation was
   broken on its first real exercise, (b) the codepath has zero data behind it,
   and (c) the Redis path is byte-identical for the Protocol contract, the cost of
   "delete now, recreate later if needed" looks lower than "fix now, maintain forever."

---

## 7. Sources

This research is **codebase-internal**. Every claim cites a `path:line` from this
working tree (commit baseline: `crew/dave/replace-stream-io-research` branched from
`origin/main` at SHA `0e4820a` "chore(release): 1.12.0 [skip ci]"). External
documentation citations were intentionally not used: the question is "what does *this
repo* do with Stream.io," not "what does Stream.io do in general." The trusted-source
research configuration at `.nwave/trusted-source-domains.yaml` was honored by the
`nw-research` skill orchestration but is not load-bearing here, since no third-party
claims are made.

The single non-codebase data point — that the bug in
`StreamIoSessionEventReader.get_events` was reproduced today and worked around by
unsetting `STREAM_API_KEY`/`STREAM_API_SECRET` — comes from Mayor's mail
(thread `thread-6db6b472e243`, message `dc-wisp-hjax`, 2026-05-07 06:24).

---

## 8. Hand-off

Design recommendation lives in
`docs/feature/replace-stream-io-with-redis/design/design.md`.
