# DESIGN Decisions — worker-tool-dispatch-refactor

## Key Decisions

- **[D1] Design scope = Application.** Worker + frontend protocol surface; no infrastructure or domain change.
- **[D2] Interaction mode = Propose**, but the seven prior open questions were resolved with the user before this DESIGN dispatched. The design is largely mechanics, not exploratory.
- **[D3] Tool dispatch via the AI SDK `tool.execute` callback pattern.** Each tool definition gets an `execute` async function that performs the dispatch (calls backend via auth-proxy, or emits a UI directive) and returns a structured result. The result is automatically folded into the message thread by `streamText`, satisfying Q7's binding constraint that Groq must see tool-call outcomes for "retry the failures" follow-ups to work.
- **[D4] Per-tool dispatchers split into family files** under `agent/lib/chat/dispatchers/`: `cleaning.ts` (PR 1), `mutations.ts` (PR 2), `ui.ts` (PR 3). One file per PR isolates blast radius; `dispatchers/index.ts` is the registry.
- **[D5] Worker uses a thin `backend-client.ts` wrapper** that targets the auth-proxy URL (Q6) and forwards the user's JWT verbatim. No service-internal token. No backend code changes.
- **[D6] Event schema lives in `shared/chat/events.ts`** (single source of truth, imported by both worker and FE via npm workspace). Validated at boundaries with Zod. FE imports as a discriminated TS union for compile-time exhaustiveness (Story 2 / AC2.1).
- **[D7] Two name refinements vs. the discuss-locked sketch:** added explicit `filters_cleared` event (was implied empty-array `filter_directive`); enriched `transform_applied` payload with `operation` and `column` fields (cheap; backend already returns them; lets FE render specific feedback without an extra fetch). Other event names locked as in `discuss/wave-decisions.md`.
- **[D8] FE shared `applyDirective` reducer** handles `{kind: "sort" | "filter" | "clear_filters"}` directives, called by both the SSE event handler and direct UI click handlers. This is the convergence point Q3 (a) called for.
- **[D9] FE component test harness uses `MockSSESource`** that exposes a `subscribe`/`emit`/`emitSequence` API. Production component takes its SSE source via prop/context so tests inject the mock; production wires the real `chatStream.ts`.
- **[D10] PR roadmap = scaffolding pre-PR + 3 family-grouped PRs, no feature flags.** PR 0 ships infrastructure with no behavior change. PR 1 (cleaning tools) unblocks `api-driven-user-flow-tests` — that feature can resume on a parallel branch as soon as PR 1 lands. PR 2 (row + column mutations). PR 3 (UI directives + final cleanup).
- **[D11] `transformStreamForResolveDataset` survives the refactor.** `resolve_dataset` is a special case — its result must short-circuit the FE chat flow (resubmit chat with resolved schema), and that pattern is preserved as-is rather than absorbed into the event vocabulary. Documented as a known asymmetry; revisit only if it grows.
- **[D12] No backend changes anywhere.** D8-DISCUSS plug-n-play property is binding throughout this design.

## Architecture Summary

- **Pattern**: Reactive subscriber / discriminated-union event protocol. The worker is the chat-protocol arbiter; the FE is a thin reactive view.
- **Paradigm**: TypeScript across both ends; FP-leaning (pure dispatcher functions, switch on discriminants, no class hierarchies). No new paradigm.
- **Key new components**:
  - `agent/lib/chat/events.ts` — event schema (Zod) (PR 0)
  - `agent/lib/chat/backend-client.ts` — auth-proxy-aware HTTP wrapper (PR 0)
  - `agent/lib/chat/dispatchers/{cleaning,mutations,ui}.ts` — per-family dispatch logic (PRs 1–3)
  - `shared/chat/events.ts` — re-export of schema for cross-workspace import (PR 0)
  - `reverse-proxy/src/core/chat/dispatcher.ts` — `applyDirective` shared body (PR 0)
  - `reverse-proxy/src/core/chat/eventHandler.ts` — SSE event switch (PR 0; populated PRs 1–3)
  - `reverse-proxy/src/core/chat/__tests__/mockSSESource.ts` — test helper (PR 0)
- **Key extended components**:
  - `agent/lib/chat/handleChat.ts` — gains DispatchContext plumbing; dispatchers attached per `contextType`
  - `agent/lib/chat/tools.ts` — schemas remain (Groq still needs them); execute callbacks attached via dispatcher modules
  - `reverse-proxy/src/core/chat/services/chatStream.ts` — annotation channel parser; legacy path coexists during migration window then removed in PR 3
- **Key deleted components** (in PR 3):
  - `reverse-proxy/src/core/toolCalls/executeToolCall.ts` — the imperative dispatcher this refactor obsoletes

## Reuse Analysis

| Existing Component | File | Overlap | Decision | Justification |
|---|---|---|---|---|
| Worker chat handler | `agent/lib/chat/handleChat.ts` | Already handles streaming; needs to grow tool dispatch | EXTEND | Add DispatchContext plumbing; attach `execute` callbacks. ~50 LOC change. |
| Worker tool schemas | `agent/lib/chat/tools.ts` | Tools still need Zod schemas for Groq tool-calling | EXTEND | Schemas stay; `execute` callbacks attached via dispatcher modules at registration time |
| `transformStreamForResolveDataset` | `agent/lib/chat/handleChat.ts` (existing) | Bespoke handling for `resolve_dataset` | EXTEND (preserve as-is) | One-off pattern; absorbing into the event vocabulary would require modeling "FE resubmit-with-context" as an event type — out of proportion to value. Keep documented |
| FE imperative tool dispatcher | `reverse-proxy/src/core/toolCalls/executeToolCall.ts` | The thing this refactor obsoletes | DELETE in PR 3 | Replaced by `eventHandler.ts` + `applyDirective`; not extended |
| FE chat stream consumer | `reverse-proxy/src/core/chat/services/chatStream.ts` | Currently parses raw AI SDK stream | EXTEND | Add annotation-channel parsing; forward to `eventHandler`. Legacy path coexists during migration |
| FE column-sort click handlers | `reverse-proxy/src/components/.../{table headers}` | Today set TanStack state inline | MODIFY (PR 3) | Call `applyDirective({kind:"sort", ...})` instead. Convergence point with chat directives |
| Auth-proxy | `auth-proxy/app.ts` | Existing token verification + identity-header proxy | EXTEND (no code change) | Use as-is. Worker dispatches go through it. Same topology as production |
| `shared/chat/` workspace | `shared/chat/*` | Existing cross-workspace shared code dir | EXTEND | Add `events.ts` here. No new workspace |
| Vitest test runner | `reverse-proxy/vitest.config.*.ts` | Existing FE test infra | EXTEND | `MockSSESource` is a vitest-native helper. No new runner |
| Pytest backend integration tests | `backend/tests/integration/` | Pattern carries forward to downstream worker tests | EXTEND (in `api-driven-user-flow-tests`) | Not in scope here; flagged for the unblocked feature |

**Zero unjustified `CREATE NEW`.** Every new file fills a genuine protocol-surface gap (events schema, dispatchers, mock source) that no existing component provides.

## Technology Stack

- **Existing**: Hono (worker), Vercel AI SDK (`ai`, `@ai-sdk/groq`), React + TanStack Query + TanStack Table (FE), Zod (already in worker for tool schemas).
- **No new languages, frameworks, or libraries.** Discriminated unions are native TS; the AI SDK already supports `tool.execute`; auth-proxy is an existing service.
- **Optional addition**: Zod schemas for runtime validation of incoming events at the FE boundary. Already a dependency; this is a pattern, not a dep.

## Constraints Established (DESIGN-side)

- **One SSE stream per chat turn carries both assistant-text deltas and typed events** via the AI SDK's annotation channel. The FE demultiplexes in `chatStream.ts`.
- **Tool `execute` callbacks must NEVER throw past the AI SDK boundary.** Errors must be caught, emitted as `error_occurred`, and returned as `{ ok: false, error }` so the message thread carries the failure context (Q7's "retry the failures" affordance depends on this).
- **All worker-to-backend HTTP calls go through `auth-proxy`** (Q6 / D5). No direct backend URLs in worker code.
- **Every SSE event passes Zod validation** at the FE boundary before reaching `handleChatEvent`. A malformed event from the worker is logged and dropped, not crashed-on.
- **The `default: const _exhaustive: never = event` line** in FE's `handleChatEvent` is the structural guarantee for AC2.1. Never remove it.
- **Per-tool dispatcher tests use `nock` (or equivalent fetch mock)** to stub the auth-proxy / backend response and assert the emitted event. No real auth-proxy or backend boot needed for unit tests; integration tests get them via the full stack.

## Upstream Changes

None. DISCUSS's locked answers stood up to DESIGN scrutiny without revision; AC text in `user-stories.md` is unchanged. No `upstream-changes.md` file created.

## Routing Forward

1. **DISTILL** (`/nw-distill`) — encode acceptance tests for both ends:
   - Worker integration test: drive a chat turn, assert the typed events emitted in order (no FE involvement).
   - FE component test: feed a canned `MockSSESource` event sequence, assert UI/cache reactions.
   - Full-stack integration via `api-driven-user-flow-tests` once PR 1 lands (parallel track).
2. **DELIVER** (`/nw-deliver`) — Outside-In TDD per the PR 0 → PR 1 → PR 2 → PR 3 roadmap. Each PR's acceptance tests drive its inner-loop work.
3. **FINALIZE** (`/nw-finalize`) — after PR 3, migrate `docs/feature/worker-tool-dispatch-refactor/` to `docs/evolution/`.
4. **Unblock `api-driven-user-flow-tests`** as soon as PR 1 lands; revise its `design/design.md` §2 (the wrinkle disappears) and §10 (worked example collapses to "send prompt, observe events, query state").
