/**
 * Hono middleware that binds the request correlation id ambiently.
 *
 * auth-proxy is the single mint point (ADR-054): an inbound `X-Request-Id` (or,
 * tolerantly, `X-Correlation-Id`) is reused verbatim — mint-once — and a UUID is
 * minted only as a fallback for a direct call that did not traverse the proxy.
 * The whole downstream handler (and any stream/continuation it spawns) runs
 * inside the opened `AsyncLocalStorage` scope, so `getCorrelationId()` reads the
 * right id from a log line emitted anywhere in the request.
 */

import { randomUUID } from "node:crypto";

import type { MiddlewareHandler } from "hono";

import { runWithCorrelationId } from "./store";

/** Build the ingress correlation-binding middleware. */
export function correlationMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const inbound = c.req.header("x-request-id") || c.req.header("x-correlation-id");
    const id = inbound || randomUUID();
    await runWithCorrelationId(id, async () => {
      await next();
    });
    echoCorrelationId(c, id);
  };
}

/**
 * Echo the bound correlation id on the response as `X-Request-Id`, sourced from
 * the ambient binding (never re-minted), so an operator can copy it straight
 * from an error response. Clones the response when its headers are immutable
 * (e.g. a proxied/streamed `fetch` Response), preserving the body stream.
 */
export function echoCorrelationId(
  c: { res: Response },
  id: string,
): void {
  try {
    c.res.headers.set("X-Request-Id", id);
  } catch {
    const cloned = new Response(c.res.body, c.res);
    cloned.headers.set("X-Request-Id", id);
    c.res = cloned;
  }
}
