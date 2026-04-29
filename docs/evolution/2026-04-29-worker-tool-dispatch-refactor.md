# Worker Tool Dispatch Refactor — Evolution

> **Feature**: worker-tool-dispatch-refactor
> **Finalized**: 2026-04-29
> **Epic**: dc-ms8
> **Final PR**: dc-ms8.1 (PR 3 — UI directives migrated; legacy executor deleted)

## Summary

Decoupled the frontend from the chat protocol. The agent worker is now the single arbiter of chat tool calls; it dispatches them via the AI SDK `tool.execute` callback and emits a closed, typed SSE event vocabulary that the FE applies through a discriminated-union `handleChatEvent` switch. The legacy imperative `executeToolCall.ts` dispatcher is deleted. Backend stays chat-unaware.

## Business Context

Before this refactor, the FE owned chat-protocol interpretation: it parsed raw Groq tool-call deltas, dispatched mutations, and resolved view state — every change was cross-cutting and headless tests of chat-driven behavior were impossible without parallel construction. The downstream `api-driven-user-flow-tests` feature was blocked on this design gap.

Outcome: a developer can add a chat tool, change FE reaction to a chat event, or write a headless component test by injecting a `MockSSESource` — without touching three boundaries.

## Architecture (post-refactor)

- **Worker (`agent/lib/chat/`)** — single dispatcher.
  - `events.ts`: Zod schema for the closed event vocabulary (assistant_text_delta, transform_applied, row_added, row_deleted, column_renamed, transform_undone, transform_re_enabled, sort_directive, filter_directive, filters_cleared, error_occurred, turn_done).
  - `dispatchers/{cleaning,mutations,ui}.ts`: per-family `tool.execute` implementations. Cleaning + mutations call backend via `backend-client.ts` (auth-proxy URL, JWT forwarded verbatim). UI dispatchers emit directives without any backend call.
  - `dispatchers/index.ts`: registry.
  - `handleChat.ts`: attaches dispatchers per `DispatchContext`. `transformStreamForResolveDataset` survives unchanged as a documented asymmetry.
- **Frontend (`frontend/src/core/chat/`)**
  - `eventHandler.ts`: exhaustive switch with `default: const _: never = event;` (AC2.1 compile-time guarantee).
  - `dispatcher.ts` (`applyDirective`): single body shared by SSE-driven and click-driven sort/filter/clear-filters.
  - Click handlers in `DatasetView` / `TableView` register a `TableApi` on `ChatContext` and now call `applyDirective` instead of inline TanStack mutations.
- **Backend (`backend/app/`)** — untouched. Grep guard `rg -i '\b(groq|sse|tool_call|tool_calls)\b' backend/app/` returns zero matches (AC1.4 / K2).

## Migration (4 PRs)

| PR | Bead | Scope | Status |
|---|---|---|---|
| PR 0 | dc-8v9 | Scaffolding: events.ts, backend-client.ts, dispatchers/index.ts, FE dispatcher.ts, eventHandler.ts skeleton, MockSSESource, fixture-replay harness. | Merged |
| PR 1 | dc-67t | Cleaning tools (trim/standardize/fillNulls/mapValues/applyCleaningTransform) → worker dispatch. Walking skeleton un-skipped. **Unblocked** `api-driven-user-flow-tests`. | Merged |
| PR 2 | dc-xrt | Row + column mutations (addRow, deleteRow, renameColumn, undoCleaningTransform, reEnableCleaningTransform). | Merged |
| PR 3 | dc-ms8.1 (re-creation of phantom dc-dab) | UI directives (sortTable/filterTable/replaceColumnFilters/clearFilters); `executeToolCall.ts` deleted; click handlers converged on `applyDirective`; FE consumer wired to typed events. | This PR |

**Phantom merge note.** The original PR-3 bead (`dc-dab`) was closed with reason "Merged in dc-wisp-7pu" but no commit, branch, or PR existed (witness restart loop killed quartz before `gt done`). dc-ms8.1 reproduces the original scope verbatim. Recovery is logged in escalation `dc-11j`.

## Key Decisions (extracted from wave-decisions)

### From DISCUSS

- **D8** All tool calls move to worker — no "client-side tools stay in FE" carve-out. Even `sortTable` routes through worker.
- **D9** Assistant chat text streaming is preserved on the same SSE channel.
- **D10** FE keeps a separate path for direct UI clicks; chat directives and clicks share one body. (`applyDirective` is that body.)
- **Q1** Closed discriminated-union event vocabulary (~12 types). `default: const _: never = event` enforces exhaustiveness at compile time.
- **Q2** Preview-then-apply collapsed to single `transform_applied`. Table view is a pure projection of backend query data; FE never holds optimistic transform state.
- **Q4** No idempotency / SSE resume in v1. Disconnect = discard partial state, refetch dataset.
- **Q6** Worker → auth-proxy → backend, JWT forwarded verbatim. Same topology as production. No service-internal token.
- **Q7** Continue past errors; per-call events (`transform_applied` × N, `error_occurred`, `turn_done`). Binding implication: worker MUST use AI SDK `tool.execute` so tool results flow into the message thread (enables "retry the failures" follow-up turns).

### From DESIGN

- **D3** AI SDK `tool.execute` callback pattern is the dispatch mechanism.
- **D4** Per-tool dispatchers split into family files (one file per PR).
- **D6** Event schema owned by worker; FE imports a duplicate kept in sync via Zod equivalence assertion (no `shared/chat/` workspace exists in this repo — see TWD-8).
- **D7** Two refinements vs. DISCUSS sketch: explicit `filters_cleared` event; enriched `transform_applied` payload (operation, column).
- **D8** FE shared `applyDirective` reducer is the convergence point.
- **D11** `transformStreamForResolveDataset` survives the refactor as a documented asymmetry — absorbing it into the event vocabulary would require modeling FE-resubmit-with-context as a new event type, out of proportion to value.
- **D12** Zero backend changes anywhere.

### From DISTILL

- **TWD-1** Acceptance suite is vitest with explicit Given-When-Then in `describe`/`it`; `.feature` files are documentation companions.
- **TWD-2** Walking skeleton uses real Groq under `@requires_external`; deterministic scenarios use fixture-replay (recorded from real Groq runs).
- **TWD-5** Driving ports: HTTP `POST /chat` (worker), component-mount via `@testing-library/react` with `MockSSESource` (FE).
- **TWD-7** RED scaffolds throw `Error("Not yet implemented — RED scaffold")` and tag with `__SCAFFOLD__ = true` for machine-detectable cleanup.
- **TWD-8** Schema lives in `agent/lib/chat/events.ts` (canonical); FE keeps a duplicate; equivalence asserted at runtime — DELIVER decided not to introduce a `shared/` workspace.

## Lessons Learned

- **AI SDK `tool.execute` is load-bearing for "retry the failures" follow-ups.** Tool results must flow back into the message thread so Groq sees what failed. Without this, partial-progress UX (Q7 option b) breaks: the user asks "retry the failures" and Groq has no record of which tools failed.
- **Default-throws in exhaustiveness switches.** Once every event variant has a case, the `default: const _: never = event` line should NOT throw at runtime — the compile-time `never`-narrowing is the guarantee. Keep the line; remove the throw.
- **Dispatcher families per PR** kept blast radius small and made the migration reviewable. PR 0's scaffolding committed RED scaffolds with `__SCAFFOLD__ = true` so DELIVER could detect leftovers structurally.
- **Phantom merges are a real failure mode.** A bead closed with reason "Merged in X" is not proof of code on a branch. The witness zombie patrol now restarts (not destroys) polecats, but the recovery still required a fresh re-creation of the bead with verbatim original scope and explicit cross-reference to the phantom predecessor.

## Issues Encountered

- **dc-11j** — witness restart loop killed quartz mid-PR-3, leaving the bead closed-without-implementation. Recovered by re-creating the bead as dc-ms8.1 with original scope reproduced.
- **DESIGN/DISTILL gap on `shared/chat/` workspace.** DESIGN assumed an npm workspace that didn't exist. DISTILL flagged it (TWD-8); DELIVER kept duplicate files with a runtime equivalence assertion.

## Follow-ups (pre-tracked under epic dc-ms8)

- **AC4.3 design revision for `api-driven-user-flow-tests`.** Tracked as sibling under dc-ms8 (the harness now observes SSE events; `§2` and `§10` of that feature's design collapse).
- **AC4.3 verification step.** Confirm `api-driven-user-flow-tests` can resume on the new protocol.

## Deferred / v2 (out of scope)

- FE event-sourcing of SSE messages (append-only log + reducer).
- Backend idempotency via TTL cache.
- Backend independently verifies JWT (defense-in-depth — separate feature).
- SSE resume / event idempotency keys (no real-world need yet; revisit if external clients appear).

## Permanent Artifacts

- Architecture: `docs/architecture/worker-tool-dispatch-refactor/design.md`
- Walking skeleton spec: `docs/scenarios/worker-tool-dispatch-refactor/walking-skeleton.md`
- Acceptance scenarios: `agent/test/chat/acceptance/worker-tool-dispatch.test.ts`, `frontend/src/core/chat/__tests__/acceptance/fe-event-vocabulary.test.tsx`

## Commits (PR 0 → PR 3)

- `074627a` — PR 0 scaffolding (dc-8v9)
- `0510f52` — PR 1 cleaning tools (dc-67t)
- `c9c40fd` — PR 2 row + column mutations (dc-xrt)
- `0a19079` — PR 3 UI directives + legacy delete (commit subject references dc-dab; landed under dc-ms8.1)
