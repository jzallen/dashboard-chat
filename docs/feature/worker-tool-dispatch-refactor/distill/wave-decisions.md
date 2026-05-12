# DISTILL Decisions — worker-tool-dispatch-refactor

> **Wave**: DISTILL — produces acceptance tests + roadmap from DISCUSS user stories and DESIGN architecture.
> **Sources**: `discuss/{user-stories,outcome-kpis,wave-decisions}.md`, `design/{design.md,wave-decisions.md}`.
> **Reconciliation**: 0 contradictions found between DISCUSS and DESIGN. DESIGN refinements (`filters_cleared` event, enriched `transform_applied` payload, closed `error_occurred.phase` enum) are non-conflicting elaborations.

---

## Key Decisions

### TWD-1 — Runner adaptation: vitest specs are SSOT, `.feature` files are documentation companions

The nw-distill methodology assumes pytest-bdd. This project has zero pytest-bdd footprint and zero cucumber-js footprint; agent and frontend test infrastructure is **vitest** end-to-end. Adopting either runner would add a dependency and a parallel-construction tax (steps in two places).

Decision: write the runnable acceptance suite as **vitest specs with explicit Given-When-Then structure** (nested `describe` for the scenario, comment-tagged `// Given/When/Then` blocks inside each `it`). Co-locate `.feature` files in the same directory **as documentation** — they enumerate scenarios, carry tags (`@walking_skeleton`, `@real-io`, `@requires_external`, `@adapter-integration`, `@kpi`, etc.), and provide the human-readable contract. Each `.feature` scenario maps 1:1 to one vitest `it`. CI runs vitest; reviewers read either.

Trade-off accepted: the `.feature` files are not executed by a runner, so a divergence between vitest and `.feature` is detectable only by review. We mitigate with: (a) a one-time consistency check committed alongside the suite (a script that confirms every `Scenario:` heading has a matching `it()` title), (b) the doc `.feature` and the vitest spec live in the same directory so reviewers see both in one diff.

### TWD-2 — Walking-skeleton strategy: B (real local) + real Groq under `@requires_external`

Auto-detected strategy:
- Frontend reactive UI tests: pure FE concerns, `MockSSESource` synthesis. → `@in-memory`.
- Worker integration: drives `agent` HTTP `/chat` → real auth-proxy → real `backend` over docker compose. Backend hits real local SQLite + DuckDB. → `@real-io`.
- Groq is the one costly external. DESIGN §8 explicitly forbids LLM mocking ("LLM-mocking in tests forbidden by upstream production-fidelity principle"). The walking skeleton therefore uses real Groq.

Decision: **Strategy B**, with the explicit affordance that the Groq call sits behind the `@requires_external` tag so CI without `GROQ_API_KEY` skips that single scenario rather than failing. Local development with a real key runs it. All other worker integration scenarios that need to drive a tool call use a **fixture-replay** technique — record one Groq response per tool family during walking-skeleton runs; replay deterministic fixtures in subsequent scenarios. This preserves the production-fidelity principle (the recorded response IS Groq's) while keeping the suite fast and deterministic.

The fixture-replay harness will be built in PR 0 alongside the rest of the scaffolding.

### TWD-3 — Walking skeleton scenario count: exactly one, exercises PR 1's `transform_applied` path

Per methodology: "exactly ONE walking skeleton scenario per feature marked `@walking_skeleton`." The scenario chosen exercises the `applyCleaningTransform` end-to-end path described in DESIGN §7's worked example: real chat turn → real Groq → real worker dispatch → real auth-proxy → real backend → SSE `transform_applied` event observed. This is the thinnest end-to-end slice that touches every piece of the new architecture.

PR 0 alone cannot satisfy a walking skeleton because it ships no behavior change. The walking skeleton lands with PR 1, but it can be **drafted in DISTILL** as a `@pending @skip @walking_skeleton` scenario that the PR-1 polecat un-skips.

### TWD-4 — Container topology for `@real-io` scenarios: existing docker compose

The project already has a docker compose (`make up` per the bead description: frontend, api, agent, auth-proxy, query-engine, minio). `@real-io` worker scenarios reuse the running compose stack via `localhost:<port>` URLs. No testcontainers, no new orchestration. Scenarios start with `Given the dev compose stack is running` and skip with a clear message if the agent or auth-proxy ports are unreachable — same shape as `backend/tests/integration/test_lake_preview_live.py`.

### TWD-5 — Driving-port enforcement: HTTP for worker, component-mount for FE

Methodology mandate: every CLI / endpoint / hook in DESIGN gets at least one scenario invoking it via its protocol.

Worker driving port = HTTP `POST /chat` SSE. Walking skeleton exercises this via `fetch()` against the running agent. The vitest suite uses `EventSource`-style consumption (or `ReadableStream` on the response body) to assert the SSE event sequence. **Pipeline-level tests that call `handleChat()` directly do NOT replace this.**

FE driving port = the chat panel React component mount. AC2.x and AC3.x scenarios render the component via `@testing-library/react` with a `MockSSESource` injected via prop or context.

### TWD-6 — Adapter coverage: 4 driven adapters, all covered

Inventory:

| Adapter | `@real-io` scenario | Covered by |
|---|---|---|
| Groq (LLM) | YES (`@requires_external`) | `walking-skeleton.feature` |
| auth-proxy (HTTP middleware) | YES | walking-skeleton + every PR 1/2/3 worker scenario |
| Backend HTTP (via auth-proxy) | YES | walking-skeleton + PR 1/2/3 worker scenarios |
| SSE source (FE consumer) | partial — production path covered by walking-skeleton; FE component tests use `MockSSESource` | walking-skeleton + FE component scenarios |

Zero `NO — MISSING` rows. The fixture-replay harness handles the deterministic Groq calls without violating Mandate 6, because the fixtures **are** real Groq output captured during walking-skeleton runs.

### TWD-7 — RED scaffolds: in TS, throw `Error("Not yet implemented — RED scaffold")`

Methodology Mandate 7 maps to TS as: scaffold modules export the symbols the tests import; method bodies throw `new Error("Not yet implemented — RED scaffold")`; the file includes `// SCAFFOLD: true` (line comment) and `export const __SCAFFOLD__ = true;` (machine-detectable marker). vitest classifies thrown `Error` as a test failure (RED), not an infrastructure error (BROKEN). `import` failures would be BROKEN — the scaffolds prevent that.

Scaffolds to produce in DISTILL (one per file the DESIGN names as NEW in PR 0):

| File | Owner | Symbols |
|---|---|---|
| `agent/lib/chat/events.ts` | agent | `ChatEventSchema`, `ChatEvent` |
| `agent/lib/chat/backend-client.ts` | agent | `backendClient` (factory) |
| `agent/lib/chat/dispatchers/index.ts` | agent | `dispatcherRegistry` |
| `agent/lib/chat/dispatchers/cleaning.ts` | agent | (PR 1) `makeApplyCleaningTransformDispatcher`, etc. |
| `agent/lib/chat/dispatchers/mutations.ts` | agent | (PR 2) skeletons |
| `agent/lib/chat/dispatchers/ui.ts` | agent | (PR 3) skeletons |
| `reverse-proxy/src/core/chat/events.ts` | frontend | re-export from agent OR duplicate; see TWD-8 |
| `reverse-proxy/src/core/chat/dispatcher.ts` | frontend | `applyDirective`, `Directive` |
| `reverse-proxy/src/core/chat/eventHandler.ts` | frontend | `handleChatEvent` |
| `reverse-proxy/src/core/chat/__tests__/mockSSESource.ts` | frontend | `MockSSESource` |

All bodies throw the RED-scaffold error. PR-1/2/3 scaffolds are stubs only — DISTILL's job is to make tests RED, not to predict implementations.

### TWD-8 — Schema location: duplicate + sync test, polecat may upgrade to a workspace

DESIGN §3 references `shared/chat/events.ts` as a single source of truth shared via npm workspace import. **No `shared/` workspace exists** in the repo (`package.json` `workspaces: [frontend, agent, auth-proxy]`). This is an upstream-design assumption that doesn't hold.

DISTILL's binding decision: scaffolds live in `agent/lib/chat/events.ts` (canonical) and `reverse-proxy/src/core/chat/events.ts` (re-export pattern: `export * from "../../../../agent/lib/chat/events"` via a relative path, OR a verbatim copy with a sync test). The acceptance scenarios assert **schema equivalence at runtime** rather than at the file-location level — the assertion shape is "every event the worker emits parses against the FE's schema, and vice versa." This makes the location decision DELIVER-time, not DISTILL-time.

**Flagged for DESIGN follow-up** in `distill/upstream-issues.md`.

### TWD-9 — Backend untouched in tests too

DESIGN §6 invariant: zero backend changes in any PR. DISTILL keeps backend out of every test surface. No new pytest fixtures, no new backend test files, no characterization tests in `backend/tests/`. Worker scenarios use the existing `/api/datasets/{id}/transforms` endpoint via boto auth-proxy. AC1.4's grep guard becomes a single CI step; we capture it as a scenario in `worker-tool-dispatch.feature` so it runs alongside other tests.

### TWD-10 — Story 4 (api-driven-user-flow-tests unblocking) tested by AC1.4-style structural assertions only

Story 4 / AC4.1 / AC4.2 / AC4.3 describe the OUTCOME of this refactor on a different feature. DISTILL cannot write executable acceptance tests for AC4.3 ("when api-driven-user-flow-tests/design.md is revised, §2 is deletable") because the revision is a downstream task. We capture AC4.1 and AC4.2 as worker-side scenarios (a pytest-style integration test would prove them; we write them as vitest specs that mimic the same shape against the running stack). AC4.3 is a documentation gate, NOT an acceptance test — it lives in the **roadmap.json** as a manual-review step at the end of PR 3, not as a `.feature` scenario.

### TWD-11 — KPI-tagged scenarios

Per `outcome-kpis.md`, K1–K5 are post-merge measurements (developer-self-reported, CI grep guards, vitest run-time). Two are testable in DISTILL:

- **K2** (backend has zero chat references) → `@kpi @structural` scenario in `worker-tool-dispatch.feature` running `rg -i 'groq|sse|tool_call' backend/app/` and asserting zero matches. Doubles as AC1.4.
- **K3** (FE component test < 100ms per scenario) → soft assertion in vitest `afterEach` that prints (and does not fail) test duration; acts as a regression alarm only.

K1, K4, K5 are post-merge developer-experience metrics; not testable in DISTILL.

---

## Walking-Skeleton Strategy Summary

| Aspect | Choice |
|---|---|
| Strategy | B (real local + fake costly) |
| Real adapters | auth-proxy, backend, SSE consumer |
| Fake adapters | Groq is real for the walking skeleton, replayed-from-fixture for PR 1/2/3 deterministic scenarios |
| Container topology | existing `make up` docker compose |
| Walking skeleton scenario | exactly one (`@walking_skeleton @real-io @requires_external @driving_adapter`) — applyCleaningTransform end-to-end |
| Walking skeleton lands | PR 1 (un-skipped by polecat) |
| Walking skeleton drafted | DISTILL (as `@pending @skip`) |

## Upstream Changes Detected

See `distill/upstream-issues.md`. Two flagged:

1. **DESIGN assumes `shared/chat/` workspace that doesn't exist.** Resolved with TWD-8 default; polecat may upgrade.
2. **DESIGN's "LLM-mocking in tests forbidden" principle vs. determinism / cost.** Resolved with TWD-2 fixture-replay default; documented as a trade-off the polecat inherits, not a contradiction.

Neither is a contradiction with DISCUSS or with DESIGN's stated decisions; both are gaps DESIGN didn't cover that DISTILL had to fill. No prior-wave document is being changed.

## Routing Forward

1. **DELIVER** (`/nw-deliver`) — Outside-In TDD per `roadmap.json`. PR 0 first (scaffolding becomes real, all RED scaffolds replaced with thin real implementations + the schema-sync test going GREEN). PR 1 next (un-skips the walking skeleton). PR 2 / PR 3 in sequence.
2. **Polecat dispatch granularity**: one polecat per PR. Each PR's scope is in its own roadmap step; the polecat's bead description points at the matching scenario file(s) and the un-skip list.
3. **FINALIZE** after PR 3 → migrate `docs/feature/worker-tool-dispatch-refactor/` to `docs/evolution/`.
4. **UNBLOCK `api-driven-user-flow-tests`** as soon as PR 1 lands. Open a separate bead to revise its DESIGN doc; not part of this feature's roadmap.
