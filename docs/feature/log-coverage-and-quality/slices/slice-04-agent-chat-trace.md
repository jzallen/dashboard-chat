# Slice 04 — agent chat-path happy-path trace

**Story:** US-3 · **Sub-job:** SJ-3 · **Surface:** agent · **Effort:** ~1 day

## Goal (one sentence)
Make a chat turn visible end-to-end in the agent's logs — INFO at the turn boundaries, DEBUG for tool/model detail — using `event.action` keys that align with the `ui` consumer.

## IN scope
- Adopt the Node logger (from Slice 01) in `agent/`.
- INFO `chat.turn.start` on `POST /chat` entry (scope, context type, `session_id`/`thread_id`) and INFO `chat.turn.ok` on completion with the model finish reason (`handleChat.ts`, `pipeChatStream.ts`).
- DEBUG for tool dispatch (tool name/outcome) and Groq invocation (model); WARN/ERROR with context on dispatch/persistence failures (replace error-only `console.*`).
- Carry the correlation id (Slice 02) and tenant context (`org_id`/`project_id`) on every line.
- Align chat `event.action` keys with `ui` via `shared/chat`.

## OUT scope
- Graduating the harness-only `requestLog` ring buffer into a production audit log (separate future improvement).
- ui-side chat logging (Slice 05/06 cover ui; key *alignment* is coordinated here).

## Learning hypothesis
**Disproves** that chat-turn boundaries can be logged coherently across producer (`agent`) and consumer (`ui`) using **shared** `event.action` keys from `shared/chat`. If the two sides can't agree on a key vocabulary, a turn won't read coherently across surfaces and the shared-schema home needs extending.
**Confirms** (if it succeeds) that a single turn reads as one coherent story across both surfaces.

## Acceptance criteria
- AC1: `POST /chat` logs INFO entry + INFO completion (with finish reason).
- AC2: Tool dispatch logs each tool at DEBUG; failures log WARN/ERROR with context (not only an emitted ChatEvent).
- AC3: Every agent log line carries the correlation id and tenant context where in scope.
- AC4: Chat `event.action` keys are defined in/aligned via `shared/chat` and match the ui consumer.

## Dependencies
Uses the Node logger (Slice 01) and the correlation id (Slice 02). Coordinates key vocabulary with ui (Slices 05/06).

## Pre-slice SPIKE
Not required.

## Reference class
EXTEND of an existing Hono SSE service; `shared/chat` already exists as the single source of truth for the chat event schema, so it is the natural home for shared `event.action` keys.
