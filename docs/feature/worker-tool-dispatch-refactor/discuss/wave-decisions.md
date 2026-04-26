# DISCUSS Decisions — worker-tool-dispatch-refactor

## Key Decisions

- **[D1] Feature type = Cross-cutting.** Touches worker (`agent/lib/chat/`), frontend (chat tool dispatcher + SSE consumer), test infra (FE component tests, downstream API-driven tests), and protocol surface (the SSE event vocabulary itself, which is a contract between worker and FE). Backend is intentionally untouched — that's the point.
- **[D2] Walking skeleton = No.** Brownfield. The worker, frontend, and chat path all exist; this is a refactor of the chat protocol's dispatch boundary, not a greenfield slice.
- **[D3] UX research depth = Lightweight.** Sole user persona is a developer (extending the system); end-user UX is preserved unchanged.
- **[D4] JTBD = No.** Single obvious job ("decouple FE from chat protocol so the chat path becomes testable and the FE stays plug-n-play").
- **[D5] Lean DISCUSS — Phase 3 only.** Skipping JTBD, journey design, story-map, elephant-carpaccio slicing. Stories ship together as one architectural change. Decomposition into delivery slices belongs in DESIGN's roadmap, not here.
- **[D6] Migration gate (skill-prescribed) — bypassed.** Same rationale as `dc-1k8`, `api-driven-user-flow-tests`: project predates SSOT model adoption; project-wide migration is disproportionate.
- **[D7] Feature dir uses natural slug `worker-tool-dispatch-refactor`** per `feedback_feature_dir_naming.md` memory.
- **[D8] All tool calls move to worker** — no "client-side tools stay in FE" carve-out. Even purely-UI tool calls like `sortTable` route through worker, which translates them into typed SSE events for FE to apply. (User-stated requirement.)
- **[D9] Assistant chat text streaming is preserved.** The worker still streams Groq's assistant-text deltas to the FE for live rendering in the chat panel. The refactor is about TOOL CALLS, not chat text. (User-stated requirement.)
- **[D10] FE keeps a separate path for direct UI actions.** If a user clicks a "Sort by Region" button (not via chat), the FE handles that locally without round-tripping through the worker. Chat is *one* of multiple ways to drive UI state; this refactor is about the chat path only. (Open Question 3 below; user-pre-stated implicit answer captured here for clarity.)

## Requirements Summary

- Primary user need: a developer can add a new chat tool, change the FE's reaction to a chat event, or write headless tests for chat-driven behavior, without coupling those changes across worker / FE / backend boundaries. Today the FE owns chat-protocol interpretation, which makes every change cross-cutting and headless tests impossible without parallel construction.
- Walking skeleton scope: N/A.
- Feature type: cross-cutting (worker + FE + protocol surface).

## Constraints Established

- **Worker is the single dispatcher for tool calls coming from the chat path.** No FE code interprets Groq tool-call deltas; the FE only consumes typed SSE events that the worker emits.
- **Backend MUST stay unaware of chat.** No new endpoints, no chat-specific routes, no backend code changes in scope. If a chat tool needs to mutate persisted state, the worker calls an existing backend endpoint on the user's behalf.
- **Assistant text streaming is preserved.** The SSE channel carries both the streamed text deltas AND the typed event vocabulary. They MUST coexist on the same connection (one chat turn = one SSE stream).
- **Worker-to-backend calls forward the user's JWT.** The worker has the request's bearer token; tool-dispatched backend calls reuse it. Authorization remains user-scoped, not service-internal. (Open Question 6 confirms this.)
- **FE component tests must be possible without booting worker/Groq/backend.** A vitest can synthesize an SSE event sequence, feed it to the chat-panel component, and assert UI/cache reactions.
- **Existing FE chat behavior MUST continue working** — the user-visible chat UX (typing, seeing assistant text, watching the table update after a chat turn) is unchanged. This is a refactor; UX is not in scope.
- **No SSE protocol versioning yet.** The closed event vocabulary is a v1; clients are colocated (FE and worker ship together), so versioning is deferred. If/when external consumers appear (third-party FE, mobile, etc.), revisit.

## Upstream Changes

- None. No DISCOVER artifacts exist for this feature; the requirements are fully captured by the user's stated direction in this conversation.

## Locked Answers (resolved with user before DESIGN)

These were posed as open questions in the original DISCUSS draft and resolved interactively with the user before handing off to DESIGN. DESIGN starts from these positions, not from open questions.

### Q1 — SSE event vocabulary shape: **Shape B (discriminated union)**

Closed vocabulary, ~12 event types, each a member of a TS discriminated union with `type` as the top-level discriminant. Compile-time exhaustiveness via `case` + `default: const _: never = event;`. Starting names (DESIGN may refine):

```typescript
type ChatEvent =
  | { type: "assistant_text_delta"; delta: string }
  | { type: "transform_applied"; transform_id: string; dataset_id: string }
  | { type: "column_renamed"; dataset_id: string; old_name: string; new_name: string }
  | { type: "row_added"; dataset_id: string; row_id: string }
  | { type: "row_deleted"; dataset_id: string; row_id: string }
  | { type: "transform_undone"; transform_id: string; dataset_id: string }
  | { type: "transform_re_enabled"; transform_id: string; dataset_id: string }
  | { type: "sort_directive"; column: string; direction: "asc" | "desc" }
  | { type: "filter_directive"; column: string; filters: Filter[] }
  | { type: "error_occurred"; phase: string; message: string; failed_tool?: string; retryable: boolean }
  | { type: "turn_done"; reason: string };
```

Note: `preview_proposed` is NOT in the v1 vocabulary (see Q2).

### Q2 — Preview-then-apply two-step: **collapse to one event per cleanup op**

Worker receives both `<previewTool>` and `applyCleaningTransform` from Groq, dispatches the apply, emits a single `transform_applied`. The `preview_proposed` event type does not exist in v1.

Reinforcing invariant locked here: **the table view is a pure projection of backend query data; FE never holds optimistic state for transforms or munges rows for display.** All render state derives from refetched queries. This is binding for DESIGN.

### Q3 — Direct-FE tools: **clicks stay FE-local; share TanStack state with chat directives**

Click handlers update TanStack sort/filter state directly with no worker round-trip. Chat directives (`sort_directive`, `filter_directive`) come in as SSE events and call the same internal FE function that click handlers call. Two entry points, one body.

Reinforcing invariant: **TanStack sort/filter/search are pure view-layer navigation aids over backend-rendered data.** Neither chat directives nor clicks change the underlying SQL query.

### Q4 — Idempotency / retry: **none in v1; deferred to v2**

- Q4a (SSE resume on disconnect): no resume. One chat turn = one SSE stream. Disconnect = discard partial state. FE refetches dataset on reconnect; backend is source of truth so refetching converges.
- Q4b (worker→backend retry): no idempotency keys. Transient blip → user-visible `error_occurred`, user resubmits.

**Deferred / v2 work** (tracked here so it doesn't fall off the radar):
- **FE event-sourcing of SSE messages.** Append-only log of received events; FE state derives from log replay. Pairs naturally with the discriminated union; would simplify Story 3 component tests (synthesize event log → reduce → assert state).
- **Backend idempotency via TTL cache.** Generic `Idempotency-Key` header → in-memory or Redis cache returning no-op on duplicates within a short window. Chat-agnostic middleware; preserves backend's plug-n-play property.

### Q5 — Migration plan: **scaffolding pre-PR + 3 family-grouped PRs; no feature flags**

Project is not live; no flag plumbing needed. Cutover via parallel handlers in FE during the migration window — each PR's diff includes the deletion of the legacy raw-handler branches it replaces.

- **PR 0 — Scaffolding.** Event-vocabulary union types, `tool.execute` plumbing in worker (`agent/lib/chat/handleChat.ts`), FE dispatcher shell, test fixtures (`MockSSESource` for vitest).
- **PR 1 — Cleaning tools.** `trimWhitespace` / `standardizeCase` / `fillNulls` / `mapValues` / `applyCleaningTransform` migrate to worker dispatch. All emit `transform_applied`. **This PR unblocks `api-driven-user-flow-tests`.**
- **PR 2 — Row + column mutations.** `addRow` / `deleteRow` / `renameColumn` / `undoCleaningTransform` / `reEnableCleaningTransform` migrate. Emit `row_added` / `row_deleted` / `column_renamed` / `transform_undone` / `transform_re_enabled`.
- **PR 3 — UI directives.** `sortTable` / `filterTable` / `replaceColumnFilters` / `clearFilters` migrate. Emit `sort_directive` / `filter_directive`. Final cleanup of any leftover legacy plumbing.

Implication: `api-driven-user-flow-tests` can resume after PR 1 (parallel work track), well before PR 3 lands.

### Q6 — Authorization: **test stack includes auth-proxy; worker → auth-proxy → backend**

Test compose stack runs the auth-proxy alongside backend and worker. Worker forwards the user's JWT; auth-proxy verifies and translates to identity headers; backend reads `X-User-Id`/`X-Org-Id` per existing `trust_proxy_headers=True` mode. **Same topology as production** — no test-only auth code paths.

**Deferred / future feature** (separate from this refactor):
- **Backend independently verifies JWT even when behind auth-proxy (defense in depth / zero-trust at backend).** Currently backend trusts proxy headers; this is a single-point-of-trust gap. Worth its own feature; out of scope here.

### Q7 — Partial-progress visibility: **(b) continue past errors; emit per-call events**

When a chat turn produces multiple tool calls and one fails mid-sequence, the worker continues dispatching the remaining tool calls. Each success emits its appropriate event (`transform_applied`, etc.); each failure emits `error_occurred` with `failed_tool` set. Persisted state from prior successes stays. `undoCleaningTransform` is the explicit rollback mechanism if needed.

**Binding implementation constraint** (from this answer): the worker MUST use the AI SDK's `tool.execute` callback pattern so tool results flow back into the conversation message thread within `streamText`. This is what makes "retry the failures" work as a follow-up chat turn — Groq has visibility into which tool calls succeeded vs. failed via the message thread context. Without this, option (b) breaks: the user asks Groq to retry failures and Groq has no record of what failed.

## DESIGN-wave Inputs (resolved — historical record below)

The questions below were resolved with the user via interactive walkthrough; their answers are locked above. The original DESIGN-wave-input framing is preserved in the body of each question for traceability of how the team arrived at the answer.

### Q1 — SSE event vocabulary

What is the closed set of typed event names, payload shapes, and FE reactions? Candidates the user surfaced: `assistant_text_delta`, `transform_applied`, `dataset_renamed`, `sort_directive`, `preview_proposed`, `error_occurred`, `turn_done`. DESIGN must enumerate the full set, ground each in an existing Groq tool call (or set of calls), and lock the JSON schema. The vocabulary IS the contract — over- or under-specifying it breaks the test/independence story.

### Q2 — Preview-then-apply two-step

Today: `trimWhitespace` (preview) + `applyCleaningTransform` (commit) are emitted by Groq in the same response. Frontend currently shows the preview, then dispatches the apply. Under the refactored protocol, does the two-step survive (worker emits `preview_proposed` then `transform_applied`), or is it collapsed (worker dispatches both internally and only emits a single `transform_applied`)? Trade-offs: collapsing is simpler protocol but loses the user's ability to see-then-confirm; preserving it requires a stateful protocol where the FE confirms back to the worker.

### Q3 — Direct-FE tools (chat-independent paths)

When a user clicks a UI button to sort, filter, or add/delete rows directly (not via chat), does that path go through the worker? Or does FE keep a separate handler? Implicit DISCUSS answer (D10): FE keeps a direct path; chat is one of multiple drivers. DESIGN should confirm this and document the seam — likely: a single "intent dispatcher" inside FE that handles BOTH SSE events from the worker AND direct UI actions, with the same set of reactions. That way the chat-path and click-path converge on the same effects and component tests don't bifurcate.

### Q4 — Idempotency / retry semantics on SSE events

If a client disconnects mid-stream and reconnects (or retries), do events need idempotency keys so the FE doesn't double-apply? Or is each chat turn a single SSE stream with no resume semantics, and a disconnect just means "discard partial state, resubmit"? Trade-offs: idempotency adds protocol complexity; no-resume keeps things simple but limits robustness on flaky networks.

### Q5 — Migration plan

Big-bang (one PR moves all ~13 tools at once + flips FE) vs per-tool migration (each tool migrates independently behind a feature flag). Trade-offs: big-bang is one large PR but simpler review; per-tool is incremental but introduces a temporary "two protocols" state where the FE must handle both old (raw tool calls) and new (typed events) for some duration.

### Q6 — Authorization context for worker-to-backend calls

The worker forwards the user's JWT (already present on the chat request) to backend when dispatching a tool that mutates state. Confirm:
- The JWT is scoped enough for backend authorization decisions on the user's behalf (project ownership, org context). This is true today for FE-originated calls — same JWT is the source of truth.
- No service-internal token is needed. (Anti-goal: introducing service-internal auth.)
- Worker handles JWT-related backend errors (expired token, insufficient scope) and surfaces them as `error_occurred` SSE events with a useful enough payload that FE can decide whether to re-auth or surface to user.

### Q7 (added by DISCUSS) — Failure mode and partial-progress visibility

If the user prompts "trim whitespace on every text column" and the worker successfully dispatches 3 of 5 `applyCleaningTransform` calls before backend errors on the 4th, what does the user see? Options for DESIGN:
- (a) Worker emits `transform_applied` × 3, then `error_occurred`, then `turn_done`. FE sees partial success and renders an error banner.
- (b) Worker treats the chat turn atomically — rolls back the 3 successful transforms on the 4th's failure, emits a single `error_occurred`. (Requires backend support for transactional batches; today's backend may not have this.)
- (c) Worker reports both successes and the failure; FE responsibility to expose partial-progress UX.

This was not on the user's list but emerges naturally from D8 (all tools route through worker) — needs an answer at DESIGN.

## Routing Forward

1. **DESIGN** (`/nw-design`, propose mode) — answer Q1–Q7 with one combined design doc covering the event vocabulary, dispatcher mechanics inside the worker, FE subscriber shape, FE direct-UI seam, error handling, and a migration plan. Output to `docs/feature/worker-tool-dispatch-refactor/design/`.
2. **DISTILL** (`/nw-distill`) — write BDD acceptance tests for both ends: a worker-side test that drives a chat turn and asserts the typed events emitted, and a FE component test that synthesizes a canned SSE sequence and asserts the resulting UI/cache state.
3. **DELIVER** (`/nw-deliver`) — Outside-In TDD per the migration plan from DESIGN. Likely incremental per-tool if Q5 lands there.
4. **FINALIZE** (`/nw-finalize`).
5. **UNBLOCK `api-driven-user-flow-tests`** — once this feature lands, return to `docs/feature/api-driven-user-flow-tests/` and revise its DESIGN doc per the new (much thinner) shape: harness observes SSE events, no Python tool dispatcher needed.
