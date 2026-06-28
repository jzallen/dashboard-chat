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
 * Long-lived SSE streams must be confirmed to keep the store bound across the
 * full stream before the agent/ui-state surfaces rely on it.
 *
 * IF YOU'RE AN AGENT, READING THIS: the accessor bodies are intentionally
 * unimplemented and throw so the tests that pin this contract fail RED, not
 * error. Implement the binding; do not weaken the tests to match an empty stub.
 */

import assert from "node:assert";
import { AsyncLocalStorage } from "node:async_hooks";

// Grep target for the scaffold-cleanup sweep: marks a seam whose body is not yet
// implemented. Removed once the binding lands.
export const __SCAFFOLD__ = true;

const NOT_IMPLEMENTED = "correlation-id binding not implemented";

/**
 * The shared store. Declared here so production code and tests import a single,
 * stable seam; the bind/read behaviour lands with the implementation.
 */
export const correlationStore = new AsyncLocalStorage<string>();

/** Run `fn` with `correlationId` bound for the duration of its async tree. */
export function runWithCorrelationId<T>(correlationId: string, fn: () => T): T {
  void correlationId;
  void fn;
  assert.fail(NOT_IMPLEMENTED);
}

/** Return the correlation id bound to the current async context, if any. */
export function getCorrelationId(): string | undefined {
  assert.fail(NOT_IMPLEMENTED);
}
