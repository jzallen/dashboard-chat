# User Stories — worker-tool-dispatch-refactor

> **Wave**: DISCUSS (Phase 3 only — see `wave-decisions.md`)
> **Persona**: developer extending the chat path or the chat-reactive UI
> **JTBD reference**: skipped (D4=No); single obvious job

These stories cover one architectural change with four developer-facing effects: (1) chat tool dispatch lives in the worker, (2) the FE subscribes to a typed event vocabulary, (3) FE component tests no longer require a real worker, (4) API-driven tests downstream become honestly headless. They ship together — no story is shippable without the others — but each captures a distinct decision and AC surface.

---

## Story 1 — Worker is the single dispatcher for chat tool calls

**Narrative**: As a developer adding or changing a chat tool, I want the dispatch logic (call backend / emit SSE event / both) to live in the worker, so that I edit one module to change one tool's behavior — not the worker AND the frontend AND possibly backend in a coordinated PR.

### Elevator Pitch
Before: Adding a new chat tool requires a Zod schema in `agent/lib/chat/tools.ts` AND a corresponding dispatcher branch in the React frontend (TanStack Query interactions, optimistic updates, refetch logic). Two-language coordination per tool, every time.
After: run `agent` in dev → POST `/chat` with a prompt that triggers the new tool → sees `data: {"type":"transform_applied","transform_id":"…","dataset_id":"…"}` in the SSE stream, with no FE changes needed.
Decision enabled: developer decides whether the new chat capability ships in one PR (worker only) or two (worker + frontend), based solely on whether an existing event type covers the new tool's effect.

### Acceptance Criteria

**AC1.1 — Tool calls do not exit the worker**
> **Given** a chat turn that triggers any tool defined in `agent/lib/chat/tools.ts`
> **When** the worker streams its SSE response
> **Then** zero raw Groq tool-call deltas reach the SSE stream — only typed events from the closed vocabulary (per Q1) are emitted
> **And** the FE never receives a tool name or tool arguments directly.

**AC1.2 — Worker dispatches state-mutating tools to backend**
> **Given** a tool that mutates persisted state (`applyCleaningTransform`, `renameColumn`, `addRow`, `deleteRow`, `undoCleaningTransform`, `reEnableCleaningTransform`)
> **When** Groq emits that tool call
> **Then** the worker calls the corresponding backend endpoint (e.g., `POST /api/datasets/{id}/transforms`) with the user's JWT (forwarded from the original chat request)
> **And** waits for the backend's response before emitting any related SSE event
> **And** emits a typed event of the appropriate kind (e.g., `transform_applied`) only after the backend confirms.

**AC1.3 — Worker dispatches UI-only tools as typed directives**
> **Given** a tool that does not touch persisted state (`sortTable`, `filterTable`, `replaceColumnFilters`, `clearFilters`, the preview-only halves of cleaning ops)
> **When** Groq emits that tool call
> **Then** the worker emits a typed SSE event (e.g., `sort_directive`, `filter_directive`, `preview_proposed`) carrying the parameters needed for the FE to apply the effect locally
> **And** does NOT call backend.

**AC1.4 — Backend remains chat-unaware**
> **Given** the refactor is complete
> **When** anyone greps `backend/` for chat-related identifiers (Groq, SSE, `tool_call`, references to `agent/`)
> **Then** zero matches are found in production code
> **And** all backend endpoints used by worker dispatch existed before this feature (no new chat-specific endpoints).

---

## Story 2 — Frontend handles a closed, typed SSE event vocabulary

**Narrative**: As a frontend developer, I want the chat-panel component to react to a fixed, documented set of typed SSE events with prescribed reactions, so that adding a new chat tool that maps to an existing event type costs me zero code change, and changing how the UI reacts to an event type means editing one switch branch.

### Elevator Pitch
Before: The chat-panel React code interprets raw Groq tool-call names with a long if/else dispatcher; new tools require new branches; tool-name typos compile but silently no-op at runtime.
After: open the chat panel → trigger a chat turn that emits known events → sees the chat-panel re-render and TanStack Query cache invalidate exactly as the event-type → reaction table specifies; new event types fail TypeScript compilation if not handled.
Decision enabled: developer decides whether a new tool needs FE work (only if it requires a new event type) — the answer is now mechanical, not judgment.

### Acceptance Criteria

**AC2.1 — Vocabulary is exhaustively typed in TS**
> **Given** the FE
> **When** an event arrives whose `type` field is not in the closed vocabulary
> **Then** TypeScript fails compilation (the dispatcher is `switch (event.type) { case ... default: never }` shaped or equivalent) — no runtime branches for unknown events.

**AC2.2 — Each event type has a single canonical FE reaction**
> **Given** the vocabulary defined in DESIGN-Q1
> **When** the FE handles event type `T`
> **Then** the reaction is documented in code (named function or method per event type) and is the same regardless of which chat turn or tool emitted it
> **And** the documentation file `agent/CHAT_PROTOCOL.md` (or equivalent — DESIGN picks the path) lists every event type with its payload schema and FE reaction.

**AC2.3 — Existing chat UX is preserved**
> **Given** the same chat prompts that work today
> **When** a user runs them after the refactor
> **Then** the user-visible UX (chat text streaming, table updating, error banners) is indistinguishable from pre-refactor behavior
> **And** no Playwright tests require updating beyond cosmetic changes.

**AC2.4 — Direct-UI actions still work without going through the worker**
> **Given** a user clicks a "Sort by region" button (UI-driven, no chat)
> **When** the click handler fires
> **Then** the sort applies locally without opening an SSE connection or contacting the worker
> **And** the same internal dispatcher (per DESIGN-Q3) handles both this direct path and a `sort_directive` event from chat.

---

## Story 3 — Frontend component tests synthesize SSE events

**Narrative**: As a frontend developer writing tests for chat-reactive UI, I want to feed a canned sequence of typed SSE events into the chat-panel component and assert the resulting UI state and TanStack Query cache state, without booting a worker, contacting Groq, or hitting the backend.

### Elevator Pitch
Before: Testing "what happens when a transform is applied during chat" requires a real worker boot, real Groq call (non-deterministic, costs money), and a real backend with the expected dataset state — or extensive mocking that diverges from production over time.
After: run `npx vitest run frontend/.../chat-panel.test.tsx` → sees `PASSED chat-panel reacts to transform_applied event[invalidates dataset query, shows toast]` in <1s.
Decision enabled: FE developer decides whether their event-handling change is correct without leaving their editor or spending Groq credits.

### Acceptance Criteria

**AC3.1 — A test helper produces a fake SSE source**
> **Given** the FE test infra
> **When** a developer imports the test helper
> **Then** they can construct a `MockSSESource` with a list of events (typed per the vocabulary) and pass it to the chat panel as the SSE handle in lieu of a real connection
> **And** the helper emits events on the same channel shape the production component subscribes to.

**AC3.2 — Tests assert TanStack Query cache invalidation**
> **Given** a `transform_applied` event in the synthesized stream
> **When** the test runs the component
> **Then** the test can assert that `queryClient.invalidateQueries({queryKey: datasetKeys.detail(<id>)})` was called (or its observable effect — a refetch — fired)
> **And** the test does this without a real backend server.

**AC3.3 — Tests assert UI state for non-cache-invalidation events**
> **Given** a `sort_directive` event in the synthesized stream
> **When** the test runs the component
> **Then** the test can assert that the table's sort state matches the directive's payload, observable via the rendered DOM (rows in expected order) or the TanStack Table state.

---

## Story 4 — API-driven tests observe SSE events directly

**Narrative**: As a backend / platform developer writing headless API-driven user-flow tests (the blocked `api-driven-user-flow-tests` feature), I want pytest to open a real `/chat` SSE stream and observe the typed event vocabulary, so the harness is thin (no Python tool dispatcher) and what the test exercises matches what production runs.

### Elevator Pitch
Before: A headless test of "chat asks for trim whitespace, dataset reflects it" requires a Python re-implementation of the React frontend's tool-call dispatcher — parallel construction that drifts from production over time.
After: pytest opens `httpx.AsyncClient` against worker `/chat`, reads SSE → for each `transform_applied` event in the stream, increments a counter; calls backend `GET /api/datasets/{id}` to confirm the trimmed state.
Decision enabled: blocked feature `api-driven-user-flow-tests` becomes thin and can be unblocked the same day this refactor lands.

### Acceptance Criteria

**AC4.1 — Pytest can consume the typed event stream end-to-end**
> **Given** worker is running and a project + dataset exist
> **When** a pytest test POSTs to worker `/chat` with a prompt and reads the SSE response
> **Then** every parseable line is either an `assistant_text_delta` (ignored by the test) or one of the closed-vocabulary typed events
> **And** the test can match on `event.type` without parsing tool-call internals.

**AC4.2 — Backend state reflects what the events claim**
> **Given** a `transform_applied` event with `transform_id=X` and `dataset_id=Y`
> **When** the test issues `GET /api/datasets/Y`
> **Then** the dataset's transforms list includes `X`
> **And** the dataset preview reflects the transform's effect (e.g., trimmed whitespace if it was a trim transform).

**AC4.3 — `api-driven-user-flow-tests` is unblocked**
> **Given** this feature is merged
> **When** `docs/feature/api-driven-user-flow-tests/design/design.md` is revised per the new protocol
> **Then** §2 (the "Python tool dispatcher" wrinkle) is deletable as a section
> **And** §10's worked example collapses such that `chat_turn` is "send prompt, await events, query state" with no in-Python dispatch.

---

## Out of Scope

- **Backend changes.** No new endpoints, no chat-specific routing in `backend/`, no schema changes. The Guiding Principle "backend stays plug-n-play" is binding.
- **End-user UX changes.** This is a refactor; the chat panel looks and behaves the same to a non-developer user. AC2.3 enforces this.
- **SSE protocol versioning / external clients.** v1 vocabulary is for the colocated FE and worker only. If/when a third-party client appears, revisit (deferred).
- **Migrating non-chat-driven UI dispatch into the worker.** Direct-UI actions (clicking a sort button) keep their existing local path. Chat-driven and direct-UI converge on a shared internal dispatcher inside FE per DESIGN-Q3, but the worker is not involved in direct UI clicks.
- **Auth model changes.** Worker-to-backend calls use the user's existing JWT; no service-internal token is introduced. (DESIGN-Q6 confirms.)
- **The blocked API-driven-flow-tests feature itself.** That feature stays paused until this one lands and is unblocked then. AC4.3 captures the unblocking criterion.

## Requirements Completeness

- Four stories, fourteen AC. Each AC is verifiable: most by a test (FE component test, worker integration test, pytest), AC1.4 by a grep, AC2.3 by manual UX confirmation + the existing Playwright suite running unchanged.
- All four stories ship together in one feature window (per D5); none is shippable independently.
- Self-assessed completeness: > 0.95.

## DoR (inline — full validation deferred for this lean DISCUSS)

| # | Item | Status | Note |
|---|------|--------|------|
| 1 | User value clear | ✓ | Each story has its elevator pitch tied to a developer-experience win |
| 2 | Acceptance criteria testable | ✓ | All AC reduce to a runnable test, a grep, or an observable UX behavior |
| 3 | Dependencies identified | ✓ | Worker, FE, FE test infra; no backend changes; no new infrastructure |
| 4 | Sized | ✓ | One feature window; DESIGN's migration-plan answer (Q5) determines whether ships in one PR or several |
| 5 | Discoverable to all touchpoints | ✓ | Worker (`agent/`), FE (chat panel + tool dispatcher), FE tests (`frontend/.../*.test.tsx`), downstream test feature (`api-driven-user-flow-tests`) |
| 6 | Out-of-scope explicit | ✓ | See "Out of Scope" |
| 7 | KPIs measurable | ✓ | See `outcome-kpis.md` |
| 8 | No hidden coupling | ✓ | Backend is explicitly out of scope; the only coupling is worker↔FE protocol surface, which is the deliverable |
| 9 | Reviewable | ✓ | Reviewable per migration plan from Q5 — likely 1–N PRs depending on cutover strategy |
