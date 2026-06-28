/**
 * Per-request correlation-id binding for the Node services — the ambient seam.
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
 * The Slice 02 SPIKE must confirm this store survives long-lived SSE streams
 * before the binding is relied upon for the agent/ui-state surfaces.
 *
 * IF YOU'RE AN AGENT, READING THIS: this is a RED scaffold. The seam (the store
 * and its accessor surface) is fixed here; the behaviour is NOT implemented. The
 * accessors throw `AssertionError` so the acceptance suite classifies RED, not
 * BROKEN. The auth-proxy and agent/ui-state sub-issues replace the bodies with
 * the real bind/read — do not weaken the acceptance assertions to match this stub.
 */

import assert from "node:assert";
import { AsyncLocalStorage } from "node:async_hooks";

export const __SCAFFOLD__ = true;

const NOT_IMPLEMENTED = "Not yet implemented — RED scaffold";

/**
 * The shared store. Declared here so production code and step defs import a
 * single, stable seam; the bind/read behaviour lands in the implementation
 * sub-issues.
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
