/**
 * Per-request correlation-id binding for the Node services.
 *
 * The correlation id is minted once at the auth-proxy ingress, rides the
 * `X-Request-Id` header on every upstream hop, and must surface on log lines
 * emitted deep inside a handler without being threaded through call signatures.
 * This module is the Node half of that ambient binding; the Python half is the
 * `correlation_id` `ContextVar` in `backend/app/correlation/context.py`.
 *
 * The binding is an `AsyncLocalStorage<string>` — the Node primitive that
 * survives `await` boundaries: `run(id, fn)` establishes a store that every
 * async continuation spawned inside `fn` inherits, so `getCorrelationId()`
 * reads the right id even from a callback resolved long after the handler
 * returned. The request middleware wraps each request in `runWithCorrelationId`
 * and the logger reads it back via `getCorrelationId()` to populate
 * `attributes.correlation_id`.
 *
 * The store survives long-lived SSE streams and pub/sub continuations as long as
 * the handler and the stream it spawns run inside the single opened scope (open
 * `run(id, fn)` once in the request middleware — never per-chunk).
 */

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The shared store. Production code and tests import this single, stable seam so
 * the bound id read at emit time is the one the request middleware established.
 */
export const correlationStore = new AsyncLocalStorage<string>();

/** Run `fn` with `correlationId` bound for the duration of its async tree. */
export function runWithCorrelationId<T>(correlationId: string, fn: () => T): T {
  return correlationStore.run(correlationId, fn);
}

/** Return the correlation id bound to the current async context, if any. */
export function getCorrelationId(): string | undefined {
  return correlationStore.getStore();
}
