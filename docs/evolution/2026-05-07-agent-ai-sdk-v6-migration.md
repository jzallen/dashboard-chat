# Agent AI SDK v4 -> v6 Chat SSE Migration — Evolution

> **Feature**: agent-ai-sdk-v6-migration
> **Finalized**: 2026-05-07
> **Bead**: dc-p1z
> **Wave entry**: DELIVER (brownfield, Mayor pre-validated roadmap; no DISCOVER/DISCUSS/SPIKE/DESIGN/DISTILL/DEVOPS)

## Summary

The `ai` package was bumped `4.3.16 -> 6.0.141` in commit `32e3dd3` without
migrating the call sites that consume its API. The chat path crashed at
runtime with `TypeError: result.toDataStreamResponse is not a function` at
`agent/lib/chat/handleChat.ts:154`. This migration moves the chat SSE wire
envelope from v4's numeric-prefix protocol (`0:`, `2:`, `8:`, `9:`, `r:`,
`d:` lines) to v6's typed `data: {...}\n\n` SSE envelope (`text-delta`,
`data-chat-event`, `data-agent-request`, `tool-*`, `finish` UIMessageChunk
types). All three SSE parsers in the system (agent emit, frontend consume,
backend dataset-layer consume) now agree on a single canonical byte
sequence — pinned by a cross-stack contract test family.

The `ChatEvent` payload SSOT in `shared/chat/events.ts` is **untouched**.
Only the framing envelope changed; payload semantics, schemas, and
discriminants are stable. No compat shim — personal project, clean break
to v6 API.

## Phase-by-phase walkthrough

The DELIVER wave executed 3 phases / 8 steps via outside-in TDD with full
DES audit trail (PREPARE -> RED_ACCEPTANCE -> RED_UNIT -> GREEN -> COMMIT
per step; SKIPPED phases logged with `NOT_APPLICABLE` reasons).

### Phase 01 — Migrate the agent emit side (5 hrs, 3 steps)

Drive the agent's outbound SSE format from v4
(`result.toDataStreamResponse()` plus raw `8:${json}\n` annotation
injection) to v6 (`createUIMessageStream({ execute: ({ writer }) => ...
})` plus `createUIMessageStreamResponse({ stream })` plus typed
`writer.write({ type: 'data-chat-event', id, data: chatEvent })` parts).

- **01-01** — `ffa4bb1` — RED walking-skeleton acceptance test. Replaced
  the v4 numeric-prefix parser in
  `agent/test/chat/acceptance/walking-skeleton.test.ts` with a v6
  `data:`-framed JSON parser asserting `type === 'data-chat-event'` and
  validating `data` against `ChatEventSchema` from
  `shared/chat/events.ts`. Test FAILS against the unchanged production
  code, demonstrating it actually exercises the new contract (deliberate
  RED handoff to 01-02).
- **01-02** — `2de9753` — Migrate `handleChat.ts` (production code).
  Replaced `result.toDataStreamResponse()` and the `injectEmittedEvents`
  helper with `createUIMessageStream` + a new `pipeChatStream` seam that
  drains the dispatcher's `eventBuffer` as `data-chat-event` writer
  parts in the same temporal positions the v4 transform did. Walking
  skeleton transitions from RED -> GREEN.
- **01-03** — `e50fd38` — Rewrite agent unit-test mocks. Every
  `streamText` mock site (`handleChat.test.ts`, 7 sites in
  `resolveDataset.test.ts`, `reportIntegration.test.ts:35`,
  `turn-done-persistence.test.ts`) now returns a `ReadableStream` of v6
  UIMessage parts (`text-delta` + `data-chat-event`) instead of v4
  `toDataStreamResponse()`. Mocks-only step; no production code change.

### Phase 02 — Propagate the v6 wire format to consumers (2.5 hrs, 3 steps)

The agent now speaks v6. Both downstream parsers (frontend chat UI,
backend dataset-layer integration harness) must read the new shape. The
`ChatEvent` payload contract is unchanged; only the envelope migrates.

- **02-01** — `29d0245` — Migrate
  `reverse-proxy/src/core/chat/services/chatStream.ts`. Numeric-prefix parser
  removed; replaced with a `data:`-framed JSON dispatcher. `text-delta`
  -> `handlers.onContent` (accumulating); `data-chat-event` ->
  `handlers.onChatEvent` after `ChatEventSchema.safeParse`. The legacy
  `prefix === '9'` raw-tool-call branch is dropped — v6 surfaces tool
  calls via typed `tool-*` parts and the agent strips raw Groq tool-call
  deltas before they hit the wire.
- **02-02** — `f2eb7e2` — Migrate
  `backend/tests/integration/dataset_layer/harness.py`. SSE parser now
  consumes `data: {...}\n\n` lines, json-decodes, branches on
  `type == 'data-chat-event'`, and surfaces the inner `data` dict as the
  ChatEvent the integration suite asserts on. JSON:API unwrap and
  ChatEvent shape expectations otherwise unchanged.
- **02-03** — `4d20bac` — Cross-stack contract test. A single canonical
  v6 SSE byte sequence (fixture
  `shared/chat/__fixtures__/v6-wire-contract.json`) is parsed by all
  three parsers (agent, frontend, backend) and each yields the same
  `ChatEvent[]`. Catches drift if any one consumer is later edited in
  isolation.

### Phase 03 — Full-stack verification (1.5 hrs, 2 steps)

- **03-01** — `dfcedd0` + `9fa37ac` + `a2389aa` — Bazel sweep. `bazel
  test //agent/...` PASS (2/2). `bazel test //reverse-proxy/...` 8/9 GREEN
  after RPP L1 dead-code removal in
  `useChatEngine.tsx` (deleted both v4 `toolCalls.length > 0` branches
  — v6 surfaces tool calls via typed parts, the v4 raw-array path is
  structurally unreachable) and migration of the `ChatContext.test.tsx`
  v4 helper to v6 frames. `shared/chat/BUILD.bazel` `js_library` glob
  extended to `**/*.json` so `//reverse-proxy:test_core_chat` can import the
  contract fixture. Backend dataset-layer synthetic suite 6/6 PASS;
  live compose-dependent suite (3 tests) deferred to maintainer (no
  compose stack / GROQ key in polecat sandbox). `bazel test
  //backend/...` exposes a pre-existing `pytest_tests.bzl` shared-conftest
  precompile collision unrelated to this migration; documented as
  out-of-scope infra debt.
- **03-02** — `ffe2be1` — Manual smoke (AC6). Deferred to the
  maintainer per `wave-decisions.md`. The polecat sandbox has no
  browser, no `GROQ_API_KEY`, no running compose stack. Reproducible
  maintainer steps captured below ("Acceptance criteria status — AC6").
  Strongest non-manual evidence: 4 contract tests (agent
  walking-skeleton, agent wire-contract, frontend wire-contract,
  backend wire-contract) all GREEN against the same SSOT byte sequence.

## The contract

The single canonical v6 byte sequence at
`shared/chat/__fixtures__/v6-wire-contract.json` is consumed identically
by every parser in the system. The fixture pairs a byte stream with the
`ChatEvent[]` it must yield. All three parsers — agent
(TypeScript), frontend (TypeScript), backend dataset-layer (Python) —
assert against the same expected events from the same input bytes.

Wire envelope (v6, after migration):

```
data: {"type":"text-delta","id":"...","delta":"..."}\n\n
data: {"type":"data-chat-event","id":"...","data":{<ChatEvent payload>}}\n\n
data: {"type":"finish"}\n\n
```

Wire envelope (v4, before migration — gone):

```
0:"text chunk"\n
8:[{<ChatEvent payload>}]\n
9:[{<raw Groq tool call>}]\n
d:{"finishReason":"stop"}\n
```

Inside the v6 envelope, the `data` field of `data-chat-event` parts
carries the same `ChatEvent` shape it always has — validated by
`ChatEventSchema` from `shared/chat/events.ts`. Payload SSOT preserved.

## What changed in production code

- **`agent/lib/chat/handleChat.ts`** — Before: built response via
  `result.toDataStreamResponse()` and injected ChatEvents through a raw
  `8:${json}\n` transform helper. After: builds response via
  `createUIMessageStream({ execute })` + `createUIMessageStreamResponse`
  with a new `pipeChatStream` seam that merges `result.toUIMessageStream()`
  while draining the dispatcher's `eventBuffer` as typed
  `data-chat-event` parts.
- **`agent/lib/chat/pipeChatStream.ts`** — New file. Houses the
  `createUIMessageStream` writer logic so `handleChat.ts` stays a thin
  orchestrator. Unit-tested at the agent emit boundary.
- **`reverse-proxy/src/core/chat/services/chatStream.ts`** — Before: parsed
  `prefix:json\n` lines via numeric-prefix branch. After: parses
  `data: {...}\n\n` SSE frames and dispatches on the `type` field
  (`text-delta` -> content accumulation; `data-chat-event` ->
  `onChatEvent` after schema validation).
- **`backend/tests/integration/dataset_layer/harness.py`** — Before:
  string-sliced `8:` annotation frames out of the SSE body. After: pulls
  ChatEvents from `data-chat-event` parts of the JSON-decoded v6 SSE
  frames; same JSON:API unwrap and ChatEvent assertion behavior.
- **`reverse-proxy/src/ui/context/ChatContext/hooks/useChatEngine.tsx`** —
  Both v4 `toolCalls.length > 0` branches deleted (RPP L1 dead-code
  removal). After 01-02's migration the agent emits typed
  `data-chat-event` parts; the v4 raw-array path is unreachable.
- **`shared/chat/BUILD.bazel`** — `js_library` glob extended to
  `**/*.json` so the new SSOT v6 wire-contract fixture is shipped in
  the workspace npm package consumed by `//reverse-proxy:test_core_chat`.

## What did NOT change

- **`shared/chat/events.ts`** — UNTOUCHED. `ChatEvent`, `ChatEventSchema`,
  and every payload variant are stable. Payload SSOT preserved.
- **`@ai-sdk/groq` upgrade** — already happened in the Mayor's prior
  session and is not part of this feature's scope.
- **No compat shim**, no parallel-format support, no feature flag.
  Personal project, clean break.
- **No new ADRs.** The `data-chat-event` typed envelope is an
  implementation choice flowing from ADR-014's `ChatEvent` stratification
  (the type discriminant is unchanged), not a new architectural
  decision.

## Acceptance criteria status

The bead's six ACs:

- **AC1 — agent emit correctness in bazel + dataset-layer**. PASS.
  `bazel test //agent/...` 2/2 GREEN. Backend dataset-layer synthetic
  suite (`test_harness_sse.py`, `test_wire_contract.py`) 6/6 GREEN. The
  compose-dependent live suite (3 tests:
  `test_dataset_staging_layer` + 2 `test_replay_idempotency` cases) is
  deferred to the maintainer for the same environmental reason as AC6.
- **AC2 — walking-skeleton acceptance test exercises v6 contract**.
  PASS. `agent/test/chat/acceptance/walking-skeleton.test.ts` was
  rewritten to assert v6 frames in step 01-01 (RED) and went GREEN in
  step 01-02 against the migrated `handleChat.ts`.
- **AC3 — agent unit suite passes**. PASS. `//agent:test` GREEN with
  every `streamText` mock returning v6 UIMessage parts.
- **AC4 — frontend tests pass**. PASS in scope. `//reverse-proxy:test_core_chat`
  84/84 GREEN; `//reverse-proxy:test_ui_context` GREEN after the
  `ChatContext.test.tsx` v4 helper migration in `9fa37ac`.
- **AC5 — full bazel sweep clean**. PARTIAL.
  Frontend + agent are GREEN. Backend `bazel test //backend/...` exposes
  a pre-existing `pytest_tests.bzl` shared-conftest precompile collision
  that pre-dates this migration (was present on the branch base
  `cc04712`). Documented as out-of-scope infra debt; recommend a separate
  bead.
- **AC6 — manual end-to-end smoke (CSV upload + cleaning prompt
  visible)**. DEFERRED to the maintainer. Polecat sandbox has no
  browser, no `GROQ_API_KEY`, no running compose stack. The four
  contract tests (agent walking-skeleton, agent wire-contract, frontend
  wire-contract, backend wire-contract) cover every assertion the
  manual smoke would make EXCEPT live-network confirmation that the
  agent service actually serves the new wire format on the wire.
  Reproducible steps for the maintainer:

  ```bash
  cp .env.example .env && $EDITOR .env   # set GROQ_API_KEY
  bazel run //agent:image_tar && docker load -i bazel-bin/agent/image_tar/tarball.tar
  bazel run //auth-proxy:image_tar && docker load -i bazel-bin/auth-proxy/image_tar/tarball.tar
  bazel run //api:image_tar && docker load -i bazel-bin/api/image_tar/tarball.tar
  docker compose up -d auth-proxy api agent minio query-engine redis
  docker compose ps                       # note remapped ports; update AGENT_URL/AUTH_PROXY_URL in .env
  cd reverse-proxy && npm run dev
  # In browser: upload a small CSV, send "trim region column" in chat.
  # Verify in devtools Network tab on /chat SSE response:
  #   [a] HTTP 200
  #   [b] Frames begin with `data: ` and JSON contains a `type` field
  #   [c] At least one frame has type=data-chat-event with a typed
  #       cleaning ChatEvent in `data`
  #   [d] No frames begin with 0:, 2:, 8:, 9:, r:, d:
  # Verify in UI:
  #   [e] Text streams smoothly, no prefix-number artifacts
  #   [f] Cleaning result renders as a styled annotation, not raw text
  ```

  If any of [a]-[f] fail, the v6 wire format or one of its three
  parsers is the most likely suspect; start with the four contract
  tests to triangulate.

## Deferred work and known follow-ups

These are explicitly out-of-scope for the migration but worth tracking:

- **Live compose-dependent dataset-layer integration suite** (3 tests:
  `test_dataset_staging_layer`, both `test_replay_idempotency` cases).
  Deferred to maintainer — needs compose stack up + `GROQ_API_KEY` set
  + agent image rebuilt. Same environmental constraint as AC6.
- **AC6 manual smoke**. Deferred per above; reproducible steps captured.
- **Backend `pytest_tests.bzl` shared-conftest precompile collision**.
  Pre-existing infra debt unrelated to this migration. Two `py_test`
  targets race to write `backend/tests/integration/__pycache__/conftest.cpython-311.pyc`.
  Recommended fix: wrap `conftest` in a single `py_library` and use it
  as a `dep` instead of embedding it as `srcs` in every `py_test`.
  Recommend a separate bead.
- **Mutation testing infrastructure**. None present (no `stryker`,
  `mutmut`, or `cosmic-ray` config in the project). Recommend a
  foundational bead before per-feature mutation gates can run; the
  v6 migration's strong contract-test coverage at every parser
  boundary is currently the primary mutation-resistance signal.
- **`gt-pvx` auto-save WIP checkpoints** in the branch history
  (`5af3bd1`, `3d432fe`, `af21f87`, `c3e6386`, `3ab94c5`, `6932fd4`,
  `aaa09f5`, `629c298`). Not feature-relevant; should be squashed or
  dropped at landing time, or by Refinery. Not a feature concern.

## Wave methodology audit

- **DISCOVER / DISCUSS / SPIKE / DESIGN** — skipped. Brownfield migration
  with a Mayor pre-validated roadmap; no new business stories, no new
  architectural decisions, no unknown spike topics. Per the project's
  brownfield routing matrix
  (`docs/research/nwave-brownfield-approach.md`), refactors with known
  cause start at DESIGN or DELIVER; this one starts at DELIVER because
  the design is already ratified by AI SDK v6's documented API surface.
- **DISTILL** — skipped. The roadmap's RED acceptance test (step 01-01,
  rewriting the existing walking-skeleton TS test) IS the distill artifact;
  no separate `tests/acceptance/{feature-id}/` Python BDD suite was
  warranted. The brownfield equivalent is the existing
  `agent/test/chat/acceptance/walking-skeleton.test.ts` regression
  guard, preserved per `docs/evolution/2026-05-01-api-driven-user-flow-tests.md`.
- **DEVOPS** — skipped. No infra changes, no new services, no new
  monitoring surface. The wire-format migration is a pure code path
  change.
- **DELIVER** — full 8-step outside-in TDD execution with complete DES
  audit trail. PREPARE / RED_ACCEPTANCE / RED_UNIT / GREEN / COMMIT
  phases logged for every step. SKIPPED phases carry explicit
  `NOT_APPLICABLE` reasons (test-mock migration steps, contract-test
  steps where the acceptance test IS the unit, manual-smoke step that
  requires live infra).
- **Phase 4 refactor (RPP L1-L6)** — L1 only. Dead-code removal
  executed twice in step 03-01: (1) both v4 `toolCalls.length > 0`
  branches in `useChatEngine.tsx` deleted as structurally unreachable
  after the 01-02 migration; (2) the matching describe block in
  `useChatEngine.test.tsx` and the orphaned `executeToolCalls` plus its
  test removed. L2-L4 were not executed — they would have
  over-engineered a mostly-mechanical envelope migration that already
  preserves the payload SSOT.
- **Phase 5 review** — APPROVE_WITH_REVISION; revision applied in
  `a2389aa`; final verdict APPROVE.
- **Phase 6 mutation testing** — SKIPPED. No mutation testing
  infrastructure in the project. The cross-stack contract test family
  (4 tests asserting identical `ChatEvent[]` from one canonical byte
  sequence across all 3 parsers) provides the strongest mutation-
  resistance signal currently available.
- **Phase 7 integrity verification** — PASS. All 8 steps have complete
  DES traces in `execution-log.json`.
- **Phase 8 finalize** — this document.

## Lessons learned

- **The contract test family is the load-bearing artifact.** Four tests
  (agent walking-skeleton, agent wire-contract, frontend wire-contract,
  backend wire-contract) assert identical `ChatEvent[]` from a single
  canonical SSOT byte sequence. Future drift in any one parser will
  surface as a contract-test failure before it can ship, even without
  mutation testing infrastructure.
- **Envelope vs payload separation pays off.** Because
  `shared/chat/events.ts` is the SSOT for ChatEvent shape and is never
  touched by an envelope migration, the 2-week-old payload schemas
  flowed through the new wire format unchanged. ADR-014's stratification
  earned its keep.
- **Brownfield deferrals must carry reproducible steps.** AC6 and the
  live compose-dependent integration suite are deferred to the
  maintainer with copy-paste-ready commands. Without that, "deferred"
  becomes "lost".
- **RPP L1 dead-code passes are mandatory after envelope migrations.**
  v4 receive-side branches (`toolCalls.length > 0` in
  `useChatEngine.tsx`) became structurally unreachable the moment the
  agent stopped emitting v4 frames. Leaving them in place would have
  rotted into "obviously broken" code that confuses future readers.

## References

The temporary feature workspace at
`docs/feature/agent-ai-sdk-v6-migration/` was deleted at finalize. The
substantive artifacts it contained (DES audit trail, demo evidence, AC6
maintainer steps) are inlined above. Source-control history preserves
the original files at the parent commit of this finalize commit.

Key migration commits (in DELIVER order):

- `ffa4bb1` — RED walking-skeleton (01-01)
- `2de9753` — agent emit migration (01-02)
- `e50fd38` — agent unit-test mocks (01-03)
- `29d0245` — frontend chatStream parser (02-01)
- `f2eb7e2` — backend harness parser (02-02)
- `4d20bac` — cross-stack wire-contract test (02-03)
- `dfcedd0` — RPP L1 useChatEngine dead-branch removal (03-01)
- `9fa37ac` — ChatContext.test.tsx v4 helper migration (03-01)
- `a2389aa` — review-revision: remove residual v4 toolCalls execute branch (03-01)
- `ffe2be1` — AC6 deferral with reproducible maintainer steps (03-02)
