# Design: Replace Stream.io with Redis on the Session Event Reader

**Wave:** DESIGN
**Mode:** Propose (recommendation, not Q&A)
**Scope:** System (cross-service: backend + compose + acceptance tests)
**Author:** dave (crew, dashboard_chat)
**Date:** 2026-05-07
**Decision-maker:** Mayor
**Research input:** [`docs/research/2026-05-07-stream-io-vs-redis-session-events.md`](../../../research/2026-05-07-stream-io-vs-redis-session-events.md)
**Supersedes (proposed):** [ADR-017 — SessionEventReader dispatch](../../../decisions/adr-017-session-event-reader-dispatch.md)

---

## 1. Recommendation

**Proceed.** Delete the Stream.io tier from `SessionEventReader` dispatch. Standardize on
Redis as the only non-noop adapter. Do **not** touch the frontend chat UI's use of
Stream.io in this epic (out of scope — see §6).

Confidence: **high.** Justification:

1. The Redis adapter already implements the full `SessionEventReader` Protocol with
   strict cursor semantics matching the Stream.io adapter byte-for-byte
   (research §4 — zero functional gaps).
2. No production data lives in Stream.io. The agent-side `ThreadPersister` only knows
   `redis` and `noop` — no code path has ever written DomainEvents to Stream.io
   (research §2.C). Migration is **delete + drop env vars**, not data movement.
3. The Stream.io adapter was broken on first real exercise (Mayor session 2026-05-07
   bug in `GetOrCreateChannel`). Fixing it costs more than deleting it.
4. The "I like the Stream.io interface" preference is satisfied: the
   `SessionEventReader` Protocol — the interface the team likes — is preserved verbatim.
   What's deleted is one of two implementations behind it, not the abstraction.

**Rejected alternative:** *fix the GetOrCreateChannel bug and keep both paths.* Costs
ongoing maintenance of a vendor SDK (`stream-chat>=4.18.0`), keeps an external service
dependency in operator's mental model, and gates fast acceptance tests behind real
credentials. The deletion path is strictly lower entropy.

---

## 2. Target architecture

### 2.1 Component view (after migration — backend session event reader only)

```
┌────────────────────────────────────────────────────────────────────────┐
│                            Backend (FastAPI)                           │
│                                                                        │
│   GET /api/sessions/{id}/events                                        │
│             │                                                          │
│             ▼                                                          │
│   list_session_events use case                                         │
│             │                                                          │
│             ▼  get_session_event_reader() returns the installed reader │
│   ┌─────────────────────────────────┐                                  │
│   │ SessionEventReader (Protocol)    │  ◄── unchanged                  │
│   │   get_events(thread_id, since,   │                                  │
│   │              limit) → EventsPage │                                  │
│   └──────────────┬───────────────────┘                                  │
│                  │                                                      │
│   ┌──────────────┴───────────────────┐                                  │
│   ▼                                  ▼                                  │
│ RedisSessionEventReader      _NoopSessionEventReader                    │
│   (REDIS_URL set)              (REDIS_URL absent)                       │
└─────────┬──────────────────────────────────────────────────────────────┘
          │ XRANGE  session:events:<thread_id>  (cursor +  count=limit+1
          ▼
   ┌─────────────────────────────────────────────────────────┐
   │   Redis (single instance, compose-local in dev / managed │
   │   instance in prod) — Streams keyed `session:events:*`   │
   └─────────────────────────────────────────────────────────┘
          ▲ XADD * { data: <ChatEvent JSON> }
          │
   ┌──────┴────────────────────────────────────────────────┐
   │   Worker / Agent (Hono)                                │
   │                                                        │
   │   wrapWithTurnDoneAndPersist                           │
   │             │                                          │
   │             ▼                                          │
   │   ThreadEventPersister (interface) — unchanged         │
   │             │                                          │
   │             ▼                                          │
   │   RedisThreadPersister  /  noopThreadPersister         │
   │             ▲                                          │
   │             └── selected by REDIS_URL presence         │
   └────────────────────────────────────────────────────────┘
```

### 2.2 What changes vs. today

| Concern | Before | After |
|---|---|---|
| `SessionEventReader` Protocol | Unchanged | **Unchanged** — no consumer rewrites |
| Reader implementations | `StreamIoSessionEventReader`, `RedisSessionEventReader`, `_NoopSessionEventReader` | `RedisSessionEventReader`, `_NoopSessionEventReader` |
| Dispatch tiers | 1: stream_io · 2: redis · 3: noop | 1: redis · 2: noop |
| `ReaderKind` literal | `Literal["stream_io", "redis", "noop"]` | `Literal["redis", "noop"]` |
| Settings (`backend/app/config.py`) | `stream_api_key`, `stream_api_secret`, `stream_io_channel_type`, `redis_url` | `redis_url` only |
| Python deps | `stream-chat>=4.18.0` + `redis[asyncio]` | `redis[asyncio]` only |
| Compose env | `STREAM_API_KEY`/`STREAM_API_SECRET` passed to `agent` and `worker` services | Removed from both services |
| Acceptance test (`identity_steps.py:118`) | Writes `STREAM_API_KEY=` to suppress tier-1 selection | Line deleted (no tier-1 to suppress) |

### 2.3 Redis structures

**No new Redis structures needed.** The existing scheme — one Redis Stream per session
keyed `session:events:<thread_id>`, one DomainEvent per `XADD` entry with payload in
field `data` — already provides parity with Stream.io's interface for the
`SessionEventReader` contract:

| Stream.io concept | Redis equivalent (existing) |
|---|---|
| Channel = thread | Stream key `session:events:<thread_id>` |
| Message id (cursor) | Stream entry id (e.g. `1735689600000-0`) |
| `messages.id_gt` exclusive cursor | `XRANGE key (cursor +` exclusive lower bound |
| `messages.limit` | `XRANGE … COUNT limit` |
| Custom field `event_payload` | Field `data` (JSON-encoded `ChatEvent`) |
| Forever-retention default | Unbounded stream by default; `REDIS_STREAM_MAXLEN` opt-in |

The interface the team likes is preserved at the `SessionEventReader` layer. Nothing
under that layer needs to look like Stream.io's API for users; the cursor remains
opaque per Protocol contract.

### 2.4 What the (B) endpoint does after this epic

`POST /api/stream/stream-token` (`backend/app/routers/stream_token.py`) is **untouched**
in this epic. It returns 503 already when `stream_api_key`/`stream_api_secret` are
empty, which is the working-as-intended state in the dev compose stack today. Removing
the settings would require also removing the router (otherwise it crashes at import).
Deferring the router removal keeps the migration scope tight and decouples it from the
frontend epic (§6).

To make the no-op-router state explicit, the design adds an optional one-line hint to
the 503 body so future operators know it is intentional. *See §3 — Phase 2.*

---

## 3. Migration plan in phases

These phases are broad strokes for Mayor + a polecat to roadmap via `/nw-roadmap`. Each
phase is independently shippable; a polecat can pause between phases without leaving
the system in a half-state.

### Phase 1 — Code deletion (Outside-In TDD)

Single bead. **Order matters: tests first, then deletions.**

1. **RED** — update `backend/tests/use_cases/session/test_event_replay_dispatch.py`:
    - Delete `test_picks_stream_io_when_both_creds_set` (and the
      `test_stream_io_wins_when_both_capabilities_present` precedence test).
    - Tighten `test_picks_redis_when_only_redis_set` (and add: when **all three**
      legacy env settings + `redis_url` are absent → noop; when `redis_url` is set →
      redis).
    - Update `_settings(stream_api_key=..., stream_api_secret=...)` callers to drop
      the deleted kwargs.
    - Run the tests — they should fail at import time (the `_build_stream_io`
      symbol still exists but the test now expects new behavior).
2. **GREEN** —
    - Edit `backend/app/use_cases/session/event_replay_dispatch.py`:
        - Remove the `from stream_chat.async_chat.client import StreamChatAsync` import.
        - Remove the `from app.use_cases.session.stream_io_session_event_reader import …` import.
        - Remove `_build_stream_io`.
        - Collapse `ReaderKind` to `Literal["redis", "noop"]`.
        - Simplify `_classify` to drop the tier-1 branch and `select_session_event_reader`
          accordingly.
    - Delete `backend/app/use_cases/session/stream_io_session_event_reader.py`.
    - Delete `backend/tests/use_cases/session/test_stream_io_session_event_reader.py`.
    - Edit `backend/app/config.py` lines 88, 89, 91 — delete `stream_api_key`,
      `stream_api_secret`, `stream_io_channel_type`.
    - Edit `backend/pyproject.toml` line 47 — remove `"stream-chat>=4.18.0"`.
    - Run `uv lock` to refresh `backend/uv.lock` (the user's status shows it's
      currently deleted in the worktree — restore via the lock command, do not just
      remove the dep from the lock by hand).
3. **REFACTOR** — apply RPP L1–L2 only (rename for clarity if needed; no structural
   churn).
4. **Acceptance** — `npm run test:all` passes. The dispatch acceptance step in
   `tests/acceptance/log-image-identity-on-startup/steps/identity_steps.py:118` is
   updated in Phase 3 (line removed); leave alone in Phase 1 to keep its scope clean.

### Phase 2 — Stream.io router & compose env

1. Edit `docker-compose.yml` lines 116, 186–188, 240–241 — remove `STREAM_API_KEY`/
   `STREAM_API_SECRET` from the `agent` and `worker` services and reword the comment
   block at line 116 (it currently explains the Tier-1/Tier-2 dispatch reasoning).
2. **Decision point for Mayor (open question — see §7):** delete `stream_token_router`
   too, or leave it returning 503? The router has no `STREAM_API_KEY` to consult after
   step 1 (since `config.py` no longer surfaces those settings post-Phase 1) — so the
   router will crash at import on the missing attribute unless either:
    - **Option 2a:** delete the router entirely (and its test
      `backend/tests/integration/test_stream_token.py`, and its inclusion in
      `backend/app/main.py:28,144` and `backend/app/routers/__init__.py:12,27`).
      This breaks the frontend's `StreamProvider.tsx:21` token fetch, which today
      already returns 503 silently — so user-visible behavior is identical.
    - **Option 2b:** keep the router and hardcode 503 with a "Stream.io support has
      been removed" body. Avoids touching the frontend at all; loses ~15 lines of
      cleanup.
   **Recommendation: 2a.** It is honest about what we're deleting, and the frontend
   already tolerates the 503 (StreamProvider returns `{children}` unwrapped — see
   `StreamProvider.tsx:71`). The frontend epic (§6) will clean up the rest of (D)
   later.
3. Update `backend/tests/integration/dataset_layer/test_replay_idempotency.py:99–118`
   — drop the `or STREAM_API_KEY+SECRET` clause from the skip condition; require only
   `REDIS_URL`.

### Phase 3 — Acceptance test cleanup

1. Edit `tests/acceptance/log-image-identity-on-startup/steps/identity_steps.py:118` —
   delete the `env_path.write_text("STREAM_API_KEY=\n")` line. Now redundant.
2. Re-run the acceptance suite to confirm the step still produces the expected `.env`
   for the Redis path.

### Phase 4 — Documentation

1. Mark `docs/decisions/adr-017-session-event-reader-dispatch.md` `Status: Superseded
   by ADR-018`. Do **not** rewrite the body — superseded ADRs preserve historical
   reasoning.
2. Write `docs/decisions/adr-018-redis-only-session-event-reader.md` (skeleton in §3.1
   below). Cite ADR-017 as the supersedee.
3. After all four phases pass CI, run `/nw-finalize` to migrate this design doc into
   `docs/evolution/2026-05-07-replace-stream-io-with-redis.md`.

#### 3.1 ADR-018 skeleton (target structure)

```
# ADR-018: Redis-only SessionEventReader

Status: Ratified
Date: 2026-05-XX
Originating wave: DESIGN — replace-stream-io-with-redis
Supersedes: ADR-017

## Context
ADR-017 picked Redis-default + Stream.io-optional as a forward-compatibility hedge.
Six months in: zero data has flowed through the Stream.io path; the adapter was
broken on first real exercise; the agent-side StreamIoThreadPersister was never
implemented. The forward compatibility we paid for went unused.

## Decision
Delete the Stream.io adapter. Keep ADR-017's capability-presence dispatch policy and
Redis-as-default outcome. Drop the Stream.io tier.

## Consequences
- Compose runs the same code in dev as in prod (already true under ADR-017; now
  trivially so).
- One fewer external service in the operator's mental model.
- If Stream.io is wanted back, restore `StreamIoSessionEventReader` from git history
  (commit `<phase-1 SHA>`), re-add the tier in dispatch, and re-add the env vars to
  `config.py`. The Protocol contract is unchanged so re-introduction is purely
  additive.

## Forbidden (preserved from ADR-017)
- Branching on NODE_ENV / ENV / APP_ENV. Capability presence remains the single
  source of truth.
```

### 3.2 Phase ordering rationale

Phases 1 and 2 must ship as **separate beads** because Phase 1 deletes the settings
that Phase 2's router depends on. Doing both at once works mechanically but loses the
bisect-friendliness of small commits. Phase 3 is independent of 2 (the acceptance step
just writes an env value that's now ignored) and could go in parallel. Phase 4 ships
last so the ADR reflects what actually landed.

---

## 4. Settings strategy: hard delete vs. deprecated no-op

Recommendation: **hard delete.** No deprecation period. Reasoning:

- The settings have **no callers outside the deleted code**. Verified by grep §2 of the
  research doc — `stream_api_key`, `stream_api_secret`, `stream_io_channel_type` are
  used only in `event_replay_dispatch.py`, `stream_token.py`, and their tests.
- Deprecation periods are paid for by external consumers; there are none here.
- Dashboard Chat is a single-deployment system, not a library. There is no
  ecosystem to manage backwards compatibility for.
- The user's `.env` file may still contain `STREAM_API_KEY=...`. Pydantic settings
  ignore unknown env vars by default (`backend/app/config.py` does not override this),
  so leftover lines in operator `.env` files are silently ignored — no startup crash.
  *Verified by reading the Settings class in `backend/app/config.py`.*

---

## 5. Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Hidden caller depends on `settings.stream_api_key` outside the inventory | Low | Repo grep was exhaustive (research §2). One more grep at Phase 1 start to confirm no drift since this design |
| Removing `stream_token_router` breaks the frontend chat UI in dev | Low | Frontend already tolerates 503 (`StreamProvider.tsx:71` returns children un-wrapped). Verified by reading the file |
| `uv.lock` regeneration introduces unrelated dep updates | Medium | Run `uv lock` with `--upgrade-package stream-chat=` only? `uv` doesn't directly support that — instead, run `uv sync --no-update` after dep removal so the lock minimally reflects the deletion |
| ADR-017 references in code comments rot | Medium | Phase 4 includes a grep-and-replace pass: any code comment citing "ADR-017" is updated to "ADR-018 (supersedes ADR-017)" |
| Acceptance test for log-image-identity becomes flaky | Low | Phase 3 reruns the suite after the line deletion; CI catches drift |

---

## 6. Out of scope

Explicitly **not** in this epic:

1. **Frontend chat UI's dependency on `stream-chat` and `stream-chat-react`** —
   research §2.D. This is a separate, much larger epic. It would replace channels,
   websocket subscriptions, JWT auth against Stream's hosted service, and React
   chat components. Suggested epic name when scoped:
   *"Replace frontend Stream.io chat with native chat UI."* Deciding whether/when
   to do that is Mayor's call.
2. **`POST /api/stream/stream-token` router cleanup beyond Phase 2** — the router is
   deleted in Phase 2 because Phase 1 removes the settings it reads. If Mayor
   prefers Option 2b (router stays, hardcoded 503), that is a one-line edit instead
   and changes nothing else in this design.
3. **`stream-chat`/`stream-chat-react` package removal from `frontend/package.json`,
   `pnpm-lock.yaml`, `package-lock.json`** — would break the frontend chat UI; deferred
   to (1).
4. **Replacing Stream.io as the live-realtime fanout for the chat UI** — the (D)
   surface uses Stream.io's websocket layer, which Redis pub/sub can replicate but
   only as part of the larger frontend epic.
5. **Data migration** — none possible. Nothing to migrate (research §6 risk 1).
6. **Schema/Protocol changes to `SessionEventReader`** — the contract is preserved
   verbatim. This is deletion, not a redesign.

---

## 7. Open questions for Mayor

1. **Phase 2 router decision (Option 2a vs. 2b).** The design recommends 2a (delete
   the `stream_token_router` and its test). Confirm this is acceptable, or fall back
   to 2b (router stays, returns hardcoded 503). The deciding factor is whether Mayor
   wants the deletion to be visibly *complete* on the backend, or *minimally
   invasive* (delaying the router until the frontend epic).
2. **ADR-017 status string.** Convention check: does the repo use `Status: Superseded
   by ADR-018` (writing the supersedee inline) or `Status: Superseded` with a
   pointer in the body? `docs/decisions/` doesn't have a prior superseded ADR to
   pattern-match on. Default to inline reference unless told otherwise.
3. **Bead structure.** The phases break naturally into 3–4 beads (Phase 1 + 2 + 3 +
   4, possibly fold 3 into 1). Roadmap-time decision; flagging for awareness.
4. **`uv.lock` regen approach.** The repo currently has `backend/uv.lock` *deleted*
   in the worktree (per `git status`). That seems unrelated to this work. Confirm
   the polecat should regen via `uv lock` from a clean state, not preserve some
   in-flight modification.
5. **Frontend epic kickoff signal.** Out of scope for this epic, but worth Mayor's
   awareness: as soon as Phase 2 lands, `StreamProvider.tsx:71` returns `{children}`
   100% of the time in dev (no `STREAM_API_KEY` env var → no Stream.io UI mounts).
   That's the same as today's working-state, but it's now permanent. If anyone is
   actively building features against the Stream.io chat UI, Phase 2 ships with a
   note in the PR description.

---

## 8. Acceptance criteria for the epic

These belong on the polecat's roadmap (not this design doc), but listing here so
Mayor can sanity-check before invoking `/nw-roadmap`:

1. `grep -ri "stream[-_](io|chat|api)" backend/` returns zero hits.
2. `grep -i "stream-chat" backend/pyproject.toml backend/uv.lock` returns zero hits.
3. `npm run test:all` is green.
4. `tests/acceptance/log-image-identity-on-startup/` passes without `STREAM_API_KEY`
   in env.
5. `docker compose up -d` from a clean checkout starts cleanly with no
   `STREAM_API_*` env vars defined.
6. Dispatch acceptance test (Mayor's session 2026-05-07 reproducer) selects `redis`,
   not `stream_io`, with `REDIS_URL` set and `STREAM_API_KEY`/`STREAM_API_SECRET`
   absent — and there is no longer a code path where a 500 is possible.
7. ADR-018 is ratified; ADR-017 marks it as supersedee.

---

## 9. Hand-off

Mayor reviews → decides → invokes `/nw-roadmap` (probably) on this design with the
research doc as input → polecat executes via `/nw-deliver` per phase.
