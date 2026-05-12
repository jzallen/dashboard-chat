# Design — worker-tool-dispatch-refactor

> **Status**: proposed
> **Source**: `docs/feature/worker-tool-dispatch-refactor/discuss/{user-stories,outcome-kpis,wave-decisions}.md`
> **Mode (D1)**: Propose
> **Scope (D0)**: Application
> **Skipped (per user direction)**: C4 diagrams, domain modeling, SSOT `brief.md` bootstrap
> **All seven open questions resolved with the user before this DESIGN dispatch.** See `discuss/wave-decisions.md` ## Locked Answers.

---

## 1. Worker-side dispatcher mechanics

Today `agent/lib/chat/handleChat.ts` is a thin pipe: `streamText({ tools, ... })` → `result.toDataStreamResponse()` → return as-is, except for one bespoke transform (`transformStreamForResolveDataset`) that intercepts the `resolve_dataset` tool. The tool definitions in `agent/lib/chat/tools.ts` declare schemas only — none have `execute` callbacks, so dispatch happens client-side.

The refactor:

1. **Each tool gains an `execute` callback** that does the dispatch work and returns a structured result. `streamText` invokes these callbacks during streaming; tool results are folded into the message thread automatically (Q7's binding constraint — this is what makes "retry the failures" work because Groq sees the tool results in the next turn's context).
2. **`execute` callbacks emit typed SSE events on a side channel.** The AI SDK's data stream has a slot for arbitrary annotations alongside text deltas and tool calls; we use it to carry the discriminated-union events. The annotations ride the same SSE connection, so the FE consumes one stream.
3. **Per-tool dispatcher functions live in a new `agent/lib/chat/dispatchers/` directory**, one file per logical group (cleaning, mutations, ui-directives) so PR 1 / PR 2 / PR 3 each touch one dispatcher file.

```typescript
// agent/lib/chat/dispatchers/cleaning.ts (new file, PR 1)
import type { Tool } from "ai";
import type { ChatEvent } from "../events";
import { backendClient } from "../backend-client";

export function makeApplyCleaningTransformDispatcher(
  emit: (event: ChatEvent) => void,
  ctx: DispatchContext,
): Tool {
  return tool({
    description: "...",
    parameters: applyCleaningTransformSchema,
    async execute({ column, operation, config }) {
      try {
        const result = await ctx.backend.post(
          `/api/datasets/${ctx.datasetId}/transforms`,
          { transforms: [{ column, operation, config }] },
        );
        emit({
          type: "transform_applied",
          transform_id: result.id,
          dataset_id: ctx.datasetId,
        });
        return { ok: true, transform_id: result.id };
      } catch (err) {
        emit({
          type: "error_occurred",
          phase: "backend_dispatch",
          message: err.message,
          failed_tool: "applyCleaningTransform",
          retryable: isRetryable(err),
        });
        return { ok: false, error: err.message };
      }
    },
  });
}
```

Key invariants:
- `execute` ALWAYS returns a result that goes into the message thread (success or structured failure). Never throws past `execute` — exceptions stay scoped, and Groq sees `{ ok: false, error }` and can react.
- `emit(event)` injects into the SSE side channel synchronously after the backend confirms.
- Q7 (b) "continue past errors": the `execute` returning `{ ok: false }` does not abort the streaming loop. Groq receives the failure result and can decide to emit more tool calls (or not).

The `DispatchContext` carries the per-request state — JWT (forwarded to `backendClient`), datasetId, projectId. `backendClient` is a thin wrapper around `fetch` that targets `AUTH_PROXY_URL` (not direct backend URL — Q6 (a) routes through auth-proxy in test stack and prod alike).

`handleChat.ts` becomes a router: pick tool definitions based on `contextType`, attach the per-tool dispatchers, hand to `streamText`. The bespoke `transformStreamForResolveDataset` survives — `resolve_dataset` is the one tool whose result must short-circuit the FE flow (re-submit chat with resolved schema), and that pattern is preserved.

## 2. FE subscriber mechanics

The FE today has `reverse-proxy/src/core/toolCalls/executeToolCall.ts` — the imperative dispatcher this refactor obsoletes. Replace with two pieces:

### 2.1 The reducer (one entry point, two entry-point handlers)

```typescript
// reverse-proxy/src/core/chat/dispatcher.ts (new, PR 0 scaffolding)
type Directive =
  | { kind: "sort"; column: string; direction: "asc" | "desc" }
  | { kind: "filter"; column: string; filters: Filter[] }
  | { kind: "clear_filters" };

export function applyDirective(directive: Directive, table: TableApi) {
  switch (directive.kind) {
    case "sort":          return table.setSorting([{ id: directive.column, desc: directive.direction === "desc" }]);
    case "filter":        return table.setColumnFilters(prev => upsertFilter(prev, directive.column, directive.filters));
    case "clear_filters": return table.resetColumnFilters();
  }
}
```

This is the shared body Q3 (a) called for. Two callers:

- **SSE event handler** (chat-driven): receives `{ type: "sort_directive", column, direction }`, translates to `{ kind: "sort", ... }`, calls `applyDirective`.
- **Click handlers** (UI-driven): the existing `<th onClick>` for column sort calls `applyDirective` directly.

### 2.2 The SSE event handler

```typescript
// reverse-proxy/src/core/chat/eventHandler.ts (new, PR 0 scaffolding)
import { applyDirective } from "./dispatcher";

export function handleChatEvent(
  event: ChatEvent,
  ctx: { queryClient: QueryClient; table: TableApi; toast: ToastApi },
) {
  switch (event.type) {
    case "assistant_text_delta":
      // FE renders into the chat panel; no further dispatch
      return;
    case "transform_applied":
    case "transform_undone":
    case "transform_re_enabled":
    case "row_added":
    case "row_deleted":
    case "column_renamed":
      ctx.queryClient.invalidateQueries({
        queryKey: datasetKeys.detail(event.dataset_id),
      });
      return;
    case "sort_directive":
      return applyDirective({ kind: "sort", column: event.column, direction: event.direction }, ctx.table);
    case "filter_directive":
      return applyDirective({ kind: "filter", column: event.column, filters: event.filters }, ctx.table);
    case "filters_cleared":
      return applyDirective({ kind: "clear_filters" }, ctx.table);
    case "error_occurred":
      return ctx.toast.error(event.message);
    case "turn_done":
      return; // chat panel handles "thinking" indicator clear via this signal
    default: {
      const _exhaustive: never = event;
      throw new Error(`unhandled chat event: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
```

The `default: const _exhaustive: never = event` line gives Story 2 / AC2.1 its compile-time exhaustiveness property: if a 13th event type is added to the union and nobody updates this switch, build fails.

### 2.3 SSE consumer wiring

`reverse-proxy/src/core/chat/services/chatStream.ts` currently consumes the raw AI SDK data stream and hands tool calls to `executeToolCall`. After this refactor: it parses the AI SDK stream's annotation slot, extracts `ChatEvent` objects, and forwards each to `handleChatEvent`. The chat-text-delta slot continues to feed the chat panel renderer untouched (Q2 / D9 — assistant text streaming preserved).

## 3. Event vocabulary — full schema

Refining the Shape B sketch from `discuss/wave-decisions.md`. Two name changes, otherwise as locked:

```typescript
// agent/lib/chat/events.ts (new, PR 0 scaffolding — copied verbatim into reverse-proxy/src/core/chat/events.ts)
import { z } from "zod";

export const ChatEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("assistant_text_delta"),
    delta: z.string(),
  }),
  z.object({
    type: z.literal("transform_applied"),
    transform_id: z.string(),
    dataset_id: z.string(),
    operation: z.enum(["trim", "upper", "lower", "title", "snake", "kebab", "fill_null", "map_values"]),
    column: z.string(),
  }),
  z.object({
    type: z.literal("column_renamed"),
    dataset_id: z.string(),
    old_name: z.string(),
    new_name: z.string(),
  }),
  z.object({
    type: z.literal("row_added"),
    dataset_id: z.string(),
    row_id: z.string(),
  }),
  z.object({
    type: z.literal("row_deleted"),
    dataset_id: z.string(),
    row_id: z.string(),
  }),
  z.object({
    type: z.literal("transform_undone"),
    transform_id: z.string(),
    dataset_id: z.string(),
    mode: z.enum(["disable", "delete"]),
  }),
  z.object({
    type: z.literal("transform_re_enabled"),
    transform_id: z.string(),
    dataset_id: z.string(),
  }),
  z.object({
    type: z.literal("sort_directive"),
    column: z.string(),
    direction: z.enum(["asc", "desc"]),
  }),
  z.object({
    type: z.literal("filter_directive"),
    column: z.string(),
    filters: z.array(FilterSchema),  // imported; same shape FE uses today
  }),
  z.object({
    type: z.literal("filters_cleared"),
  }),
  z.object({
    type: z.literal("error_occurred"),
    phase: z.enum(["auth", "authz", "backend_dispatch", "validation", "groq", "unknown"]),
    message: z.string(),
    failed_tool: z.string().optional(),
    retryable: z.boolean(),
  }),
  z.object({
    type: z.literal("turn_done"),
    reason: z.enum(["stop", "length", "request", "error"]),
  }),
]);

export type ChatEvent = z.infer<typeof ChatEventSchema>;
```

Refinements vs. wave-decisions sketch:
- `transform_applied` payload gains `operation` and `column` so FE can render specific feedback (e.g., "trimmed region") without an extra fetch. Cheap; backend already returns these on the create response.
- `transform_undone` payload gains `mode` (disable vs. delete) — needed because the FE reaction differs (delete is destructive; disable is reversible).
- Added explicit `filters_cleared` event (was implied by `filter_directive` in DISCUSS sketch). Cleaner: a `clear` operation has no column or filter list, so a separate event is more honest than an empty-array sentinel.
- `error_occurred.phase` is a closed enum, not a free string. Limits the FE branch surface; expandable later.
- `turn_done.reason` mirrors AI SDK's finish reasons.

The schema lives in **one file shared by worker and frontend** via npm workspace import (the existing `shared/chat/` workspace already follows this pattern). Single source of truth; impossible for the two ends to drift on payload shape.

## 4. `MockSSESource` test helper (Story 3 / AC3.1)

```typescript
// reverse-proxy/src/core/chat/__tests__/mockSSESource.ts (new, PR 0 scaffolding)
import type { ChatEvent } from "../events";

export class MockSSESource {
  private listeners: ((event: ChatEvent) => void)[] = [];

  /** Register a listener — production component does this on mount. */
  subscribe(fn: (event: ChatEvent) => void) {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter(l => l !== fn); };
  }

  /** Emit one event synchronously. Use in tests to drive component state. */
  emit(event: ChatEvent) {
    for (const listener of this.listeners) listener(event);
  }

  /** Emit a sequence with optional delays for tests that care about ordering. */
  async emitSequence(events: ChatEvent[], { delayMs = 0 } = {}) {
    for (const event of events) {
      this.emit(event);
      if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
    }
  }
}
```

The chat-panel component takes its SSE source via prop / context, so tests can inject a `MockSSESource` while production uses the real `chatStream.ts` parser. Example test:

```typescript
// reverse-proxy/src/components/chat/__tests__/chatPanel.test.tsx (PR 1 sample)
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MockSSESource } from "@/core/chat/__tests__/mockSSESource";

it("invalidates dataset query on transform_applied", async () => {
  const queryClient = new QueryClient();
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  const source = new MockSSESource();

  render(
    <QueryClientProvider client={queryClient}>
      <ChatPanel sseSource={source} />
    </QueryClientProvider>
  );

  source.emit({
    type: "transform_applied",
    transform_id: "t-123",
    dataset_id: "ds-456",
    operation: "trim",
    column: "region",
  });

  await waitFor(() => {
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: datasetKeys.detail("ds-456"),
    });
  });
});
```

No worker. No Groq. No backend. Test runs in <100ms (Story 3 K3 target).

## 5. PR roadmap

Per Q5 locked answer: scaffolding pre-PR + 3 family-grouped PRs. No feature flags (project not live).

### PR 0 — Scaffolding

- `agent/lib/chat/events.ts` (NEW) — discriminated-union schema.
- `shared/chat/events.ts` (NEW or extend existing shared types) — re-export so FE imports the same source.
- `agent/lib/chat/backend-client.ts` (NEW) — thin `fetch` wrapper that knows the auth-proxy URL and forwards JWT.
- `agent/lib/chat/dispatchers/index.ts` (NEW, empty registry — populated in PR 1–3).
- `reverse-proxy/src/core/chat/events.ts` (NEW) — re-export from shared.
- `reverse-proxy/src/core/chat/dispatcher.ts` (NEW) — `applyDirective` shared body.
- `reverse-proxy/src/core/chat/eventHandler.ts` (NEW) — `handleChatEvent` switch with NO event types handled yet (every case throws "not migrated"). Builds in pieces as PRs land.
- `reverse-proxy/src/core/chat/__tests__/mockSSESource.ts` (NEW) — test helper.
- `reverse-proxy/src/core/chat/services/chatStream.ts` (MODIFY) — start parsing the annotation channel; extract `ChatEvent`s; forward to `handleChatEvent`. Legacy raw-tool-call path coexists during migration window.
- `agent/lib/chat/handleChat.ts` (MODIFY) — wire `DispatchContext` plumbing; `execute` callbacks attached per-context but stub-only initially.

This PR ships no behavior change in production; it's load-bearing infrastructure for PRs 1–3.

### PR 1 — Cleaning tools

- Migrate `trimWhitespace` / `standardizeCase` / `fillNulls` / `mapValues` / `applyCleaningTransform` to `agent/lib/chat/dispatchers/cleaning.ts`.
- Worker emits `transform_applied` on success.
- FE `eventHandler.ts` adds the `case "transform_applied":` branch.
- FE `executeToolCall.ts` deletes the corresponding cleaning-tool branches in the same diff.
- Tests: vitest component test for `transform_applied` handling; pytest worker integration test that drives a chat turn and asserts the typed event emitted (one of: `agent/__tests__/dispatchers/cleaning.test.ts`).

**Unblocks `api-driven-user-flow-tests` after this PR.**

### PR 2 — Row + column mutations

- Migrate `addRow` / `deleteRow` / `renameColumn` / `undoCleaningTransform` / `reEnableCleaningTransform` to `agent/lib/chat/dispatchers/mutations.ts`.
- Emit `row_added` / `row_deleted` / `column_renamed` / `transform_undone` / `transform_re_enabled`.
- FE handler additions; FE legacy branches deleted in same diff.
- Tests follow the PR 1 shape.

### PR 3 — UI directives

- Migrate `sortTable` / `filterTable` / `replaceColumnFilters` / `clearFilters` to `agent/lib/chat/dispatchers/ui.ts`.
- Emit `sort_directive` / `filter_directive` / `filters_cleared`.
- FE handler additions; FE legacy branches deleted in same diff.
- **Final cleanup:** delete the now-empty `executeToolCall.ts`. Delete any remaining legacy parser branches in `chatStream.ts`. Verify no raw tool-call code paths remain.

After PR 3: `agent/lib/chat/tools.ts` retains schema definitions (Groq still needs them); `executeToolCall.ts` is gone; FE has one switch with full exhaustiveness.

## 6. Component impact table

| Layer | File | PR 0 | PR 1 | PR 2 | PR 3 |
|---|---|:---:|:---:|:---:|:---:|
| Worker | `agent/lib/chat/handleChat.ts` | MODIFY (DispatchContext plumbing) | MODIFY (attach cleaning dispatchers) | MODIFY (attach mutation dispatchers) | MODIFY (attach UI dispatchers) |
| Worker | `agent/lib/chat/events.ts` | NEW (full schema) | — | — | — |
| Worker | `agent/lib/chat/backend-client.ts` | NEW | — | — | — |
| Worker | `agent/lib/chat/dispatchers/index.ts` | NEW (empty) | MODIFY (export cleaning) | MODIFY (export mutations) | MODIFY (export ui) |
| Worker | `agent/lib/chat/dispatchers/cleaning.ts` | — | NEW | — | — |
| Worker | `agent/lib/chat/dispatchers/mutations.ts` | — | — | NEW | — |
| Worker | `agent/lib/chat/dispatchers/ui.ts` | — | — | — | NEW |
| Worker (legacy) | `agent/lib/chat/tools.ts` | MODIFY (extract schemas) | MODIFY (remove cleaning tool defs) | MODIFY (remove mutation tool defs) | MODIFY (remove UI tool defs) |
| Worker tests | `agent/__tests__/dispatchers/{cleaning,mutations,ui}.test.ts` | — | NEW | NEW | NEW |
| Shared | `shared/chat/events.ts` (or workspace re-export) | NEW | — | — | — |
| FE | `reverse-proxy/src/core/chat/events.ts` | NEW (import from shared) | — | — | — |
| FE | `reverse-proxy/src/core/chat/dispatcher.ts` | NEW (`applyDirective`) | — | — | — |
| FE | `reverse-proxy/src/core/chat/eventHandler.ts` | NEW (skeleton) | MODIFY (add transform_applied case) | MODIFY (add row/column cases) | MODIFY (add ui cases; remove default-throws) |
| FE | `reverse-proxy/src/core/chat/services/chatStream.ts` | MODIFY (parse annotations; forward to eventHandler) | — | — | MODIFY (delete legacy parser) |
| FE (legacy) | `reverse-proxy/src/core/toolCalls/executeToolCall.ts` | — | MODIFY (remove cleaning branches) | MODIFY (remove mutation branches) | DELETE |
| FE | direct-UI handlers (column sort/filter clicks) | — | — | — | MODIFY (call `applyDirective` instead of inline state set) |
| FE tests | `reverse-proxy/src/core/chat/__tests__/mockSSESource.ts` | NEW | — | — | — |
| FE tests | `reverse-proxy/src/components/chat/__tests__/chatPanel.test.tsx` | NEW (skeleton) | MODIFY (transform_applied test) | MODIFY (row/column tests) | MODIFY (ui directive tests) |

**No backend changes in any PR.** Plug-n-play property preserved.

## 7. Worked example — single `applyCleaningTransform` end-to-end

User types "Trim whitespace on the region column" in the chat panel.

```mermaid
sequenceDiagram
    participant User
    participant FE as Frontend (chat panel)
    participant Stream as chatStream.ts
    participant W as Worker (handleChat)
    participant Groq
    participant Disp as cleaning.ts dispatcher
    participant AP as auth-proxy
    participant BE as Backend
    participant Q as TanStack QueryClient
    participant T as Table component

    User->>FE: types prompt + Enter
    FE->>W: POST /chat<br/>{messages, tableSchema, contextType:"dataset", contextId, project_id}<br/>Authorization: Bearer JWT
    W->>W: authMiddleware: verify JWT
    W->>W: build DispatchContext (jwt, datasetId, projectId)
    W->>Groq: streamText(model, system, tools-with-execute, messages)

    Groq-->>W: assistant text delta "I'll trim..."
    W-->>Stream: SSE annotation: {type:"assistant_text_delta", delta:"I'll trim..."}
    Stream->>FE: (chat panel renders the text)

    Groq-->>W: tool-call applyCleaningTransform({column:"region", op:"trim", config:{}})
    Note right of Groq: AI SDK invokes execute()<br/>inside the streamText loop
    W->>Disp: execute({column:"region", op:"trim", config:{}})
    Disp->>AP: POST /api/datasets/{id}/transforms<br/>Authorization: Bearer JWT
    AP->>AP: verifyToken; set X-User-Id, X-Org-Id, X-User-Email
    AP->>BE: POST /api/datasets/{id}/transforms (no Auth header)
    BE->>BE: persist transform; regenerate dataset view
    BE-->>AP: 200 { id:"t-abc", ... }
    AP-->>Disp: 200 { id:"t-abc" }
    Disp->>Disp: emit({type:"transform_applied", transform_id:"t-abc", dataset_id, operation:"trim", column:"region"})
    Disp-->>W: returns {ok:true, transform_id:"t-abc"}
    Note right of Disp: result auto-folds into<br/>message thread for Groq
    W-->>Stream: SSE annotation: {type:"transform_applied", ...}
    Stream->>FE: handleChatEvent(event)
    FE->>Q: invalidateQueries({queryKey: datasetKeys.detail(dataset_id)})
    Q->>BE: GET /api/datasets/{id}?include_preview=true (re-fetch)
    BE-->>Q: 200 { rows trimmed }
    Q->>T: re-render with new data
    T->>User: trimmed region column visible

    Groq-->>W: finish stop
    W-->>Stream: SSE annotation: {type:"turn_done", reason:"stop"}
    Stream->>FE: handleChatEvent({type:"turn_done"})
    FE->>FE: clear "thinking" indicator
```

Key properties this trace exhibits:
- **Worker is the dispatcher.** Tool result flows worker → auth-proxy → backend; FE never sees raw tool calls.
- **Auth-proxy is in the test loop.** Same hop count as production. (Q6.)
- **FE reaction is "invalidate query."** No optimistic state, no row mutation. Table renders backend's response. (Q2 / D9 invariant.)
- **Tool result folds into Groq's message thread** automatically via `tool.execute`. If a follow-up turn says "retry the failure," Groq sees the prior `{ ok: true, transform_id: "t-abc" }` and knows there was no failure to retry. (Q7.)
- **One SSE stream carries everything:** assistant text deltas AND typed events. FE `chatStream.ts` demultiplexes.

## 8. ADR-style summary

| Field | Value |
|---|---|
| **Status** | Proposed |
| **Context** | Today the FE interprets Groq tool-call deltas and dispatches to backend itself. This couples FE to the chat protocol, makes API-driven tests impossible without parallel construction, and entangles backend mutation logic with React component state. |
| **Decision** | Worker becomes the single dispatcher for ALL chat tool calls. Each tool gains a `tool.execute` callback that calls backend (via auth-proxy) for state-mutating tools, or emits a typed SSE directive for UI-only tools. FE consumes a discriminated-union event vocabulary on the same SSE channel and reacts mechanically (invalidate query / apply directive / show error / clear indicator). The `applyDirective` shared body is called by both the SSE handler and direct UI click handlers, converging the two paths. Migration via scaffolding pre-PR + 3 family-grouped PRs without feature flags. |
| **Alternatives considered** | LLM-mocking in tests (forbidden by upstream production-fidelity principle); browser-driven E2E (defeats headless requirement); keep FE dispatch + add a parallel-construction Python harness (parallel construction is precisely what triggered this refactor — see `api-driven-user-flow-tests/design/design.md` §2 wrinkle). |
| **Consequences** | Worker grows ~300–500 LOC of dispatcher code. FE shrinks: `executeToolCall.ts` deleted; `eventHandler.ts` is the new — much smaller — replacement. Backend untouched. New shared `events.ts` schema enforces protocol. Test infrastructure simplifies on both ends (`MockSSESource` for FE; thin pytest harness for downstream API-driven tests). Real Groq still in test loop with `tool.execute` results folded into messages so Groq retries are context-aware. |
| **Out of scope** | Backend changes; FE event-sourcing of SSE messages (deferred v2); backend TTL-based idempotency (deferred v2); zero-trust JWT verification at backend (separate future feature); SSE protocol versioning for external clients (none today). |
