/**
 * De-risking spike: does an `AsyncLocalStorage` store opened in a request
 * survive the async continuation of a long-lived SSE stream and a pub/sub
 * callback resolved long after the handler returned?
 *
 * The ambient correlation binding stakes everything on this: the request
 * middleware opens one store, and `createLogger(channel)` reads it back at emit
 * time. If the store is lost across the stream boundary, a log line emitted
 * mid-stream carries no `correlation_id` and the binding is unreliable — the
 * design would need a PIVOT before the agent/ui-state surfaces rely on it.
 *
 * This test reproduces the two at-risk shapes with the real primitive:
 *
 *   1. an SSE-shaped `ReadableStream` drained chunk-by-chunk across `await`
 *      boundaries (the `pipeChatStream` reader loop), emitting at stream start,
 *      mid-stream, and after several detached `setTimeout` ticks;
 *   2. a pub/sub-shaped continuation — a callback registered inside the scope
 *      and invoked from outside it on a later tick (the ui-state Redis flow
 *      router publish path).
 *
 * FINDING — PROMOTE. The store survives every continuation: each emit below
 * reads back the exact id bound at request entry, including the post-stream
 * detached ticks and the externally-invoked pub/sub callback. The binding
 * requirement the implementation must honour: the request handler AND the
 * stream/continuation it spawns must run inside the single `run(id, fn)` scope
 * (open it in the request middleware, before the handler — never per-chunk).
 */

import { AsyncLocalStorage } from "node:async_hooks";

import { describe, expect, it } from "vitest";

const als = new AsyncLocalStorage<string>();

/** Read the bound id the way `createLogger` would at emit time. */
function emit(): string | undefined {
  return als.getStore();
}

function sseShapedStream(chunkCount: number): ReadableStream<string> {
  let n = 0;
  return new ReadableStream<string>({
    async pull(controller) {
      if (n >= chunkCount) {
        controller.close();
        return;
      }
      // Each chunk resolves on a later microtask/macrotask, mirroring tokens
      // arriving from the upstream model over the life of the stream.
      await new Promise((resolve) => setTimeout(resolve, 1));
      controller.enqueue(`chunk-${n++}`);
    },
  });
}

describe("AsyncLocalStorage survival across long-lived continuations (DC-134 spike)", () => {
  it("keeps the bound id readable at SSE stream start, mid-stream, and late detached ticks", async () => {
    const BOUND = "spike-sse-id";
    const seen: Array<string | undefined> = [];

    await als.run(BOUND, async () => {
      seen.push(emit()); // stream start

      const reader = sseShapedStream(4).getReader();
      try {
        while (true) {
          const { done } = await reader.read();
          if (done) break;
          seen.push(emit()); // mid-stream, after an await boundary
        }
      } finally {
        reader.releaseLock();
      }

      // Detached continuations scheduled from inside the scope but resolved
      // after the handler's synchronous body returned.
      await Promise.all(
        [0, 1, 2].map(
          (tick) =>
            new Promise<void>((resolve) =>
              setTimeout(() => {
                seen.push(emit());
                resolve();
              }, tick),
            ),
        ),
      );
    });

    expect(seen.length).toBeGreaterThanOrEqual(8);
    expect(seen.every((id) => id === BOUND)).toBe(true);
  });

  it("keeps the bound id readable from a pub/sub callback invoked outside the scope", async () => {
    const BOUND = "spike-pubsub-id";
    let captured: string | undefined = "unset";

    // Register the subscriber inside the scope (ui-state flow-router publish
    // registers its handler while serving the request)...
    const subscriber = (): void => {
      captured = emit();
    };
    als.run(BOUND, () => {
      queueMicrotask(subscriber);
    });

    // ...and let the broker invoke it on a later tick, after run() returned.
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(captured).toBe(BOUND);
  });

  it("does not leak the bound id to work outside any scope (isolation holds)", () => {
    expect(emit()).toBeUndefined();
  });
});
