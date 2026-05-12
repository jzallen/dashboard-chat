# Worker tool dispatchers

Each dispatcher converts an LLM tool call into a side effect: a backend mutation,
a UI directive, or both. They live in three families:

- `cleaning.ts` — backend cleaning transforms (`trimWhitespace`, `standardizeCase`, …)
- `mutations.ts` — backend row/column mutations (`addRow`, `renameColumn`, …)
- `ui.ts` — purely client-side render directives (`sortTable`, `filterTable`, …)

A `DispatchContext` (see `index.ts`) is threaded through to every dispatcher
factory. New tool authors should resist adding ad-hoc parameters to the factory
signatures and instead extend `DispatchContext`.

## Adding a new UI directive variant (ADR-014 / ADR-015)

UI directives are render instructions with no backend correlate. They are
ephemeral by definition: emitted on the SSE stream and applied by the FE's
`applyDirective` (`reverse-proxy/src/core/chat/dispatcher.ts`). Per ADR-015 they are
**also** mirrored into a per-channel reflect-only log so headless consumers can
reconstruct table presentation state without a browser.

Wiring a new UI dispatcher requires:

1. **Extend the schema** in `shared/chat/events.ts`. Add the new variant to
   `UiDirectiveSchema`. The FE re-exports the schema; do not redeclare types in
   `reverse-proxy/`.

2. **Extend the FE applier**. Add the `kind` mapping in
   `reverse-proxy/src/core/chat/eventHandler.ts` and the `applyDirective` switch in
   `reverse-proxy/src/core/chat/dispatcher.ts` so the FE actually renders the change.

3. **Extend the headless reducer** in `shared/chat/applyDirective.ts`. Mirror
   the FE's TanStack semantics so the contract test
   (`reverse-proxy/src/core/chat/__tests__/applyDirective-contract.test.ts`)
   continues to assert `reducer(log) ≡ FE TableApi capture`.

4. **Write the dispatcher** alongside the existing UI dispatchers in `ui.ts`.
   Do **not** call `BackendClient.post` — UI directives are purely client-side
   per the worker test invariant at
   `agent/test/chat/acceptance/worker-tool-dispatch.test.ts:502-550`. Call
   `emitAndLog(ctx, directive)` (in this file) so the directive lands on the
   SSE stream **and** is appended to the per-channel directive log:

   ```ts
   export function makeColumnVisibilityDispatcher(
     _emit: Emit,
     ctx: DispatchContext,
   ): Tool {
     return tool({
       description: "...",
       inputSchema: z.object({ /* ... */ }),
       execute: async ({ column, hidden }) => {
         emitAndLog(ctx, { type: "column_visibility_directive", column, hidden });
         return { ok: true } as const;
       },
     });
   }
   ```

   `emitAndLog` is the seam: `ctx.emit(directive)` flows to SSE, and
   `ctx.presentationState.append(channelId, directive)` flows to the
   reflect-only log. The append is best-effort — failures are caught and
   logged; the SSE emit (the user-facing contract) always lands.

5. **Register** the dispatcher in `dispatcherRegistry()` in `index.ts`.

6. **Test** the dispatcher in
   `agent/test/chat/acceptance/worker-tool-dispatch.test.ts` (the worker side)
   and the corresponding FE handler in
   `reverse-proxy/src/core/chat/__tests__/`.

Domain events (`row_added`, `transform_applied`, …) follow a different path —
they go through `BackendClient.post` in `mutations.ts` / `cleaning.ts` and are
persisted to the Stream.io thread before `turn_done` (per dc-x3y.3.1). Those
records live in a separate stream from the UI directive log. Don't conflate the
two: domain events represent state changes worth replaying; UI directives are
ephemeral renderer instructions.

## Why two streams

ADR-014 stratifies `ChatEventSchema` into `DomainEventSchema` and
`UiDirectiveSchema`. ADR-015 adds the reflect-only directive log. Together they
give consumers a clean separation:

| Stream                      | Source              | Replay target           |
|-----------------------------|---------------------|-------------------------|
| Stream.io thread (DomainEvent)  | `mutations`/`cleaning` | Headless turn replay |
| Per-channel directive log (UiDirective) | `ui` dispatchers       | Headless table state |
| SSE wire (everything)       | both                | Realtime FE             |

Both persisted streams are parallel by construction; share infrastructure when
feasible.
