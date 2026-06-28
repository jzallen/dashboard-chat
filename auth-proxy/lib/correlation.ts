/**
 * auth-proxy ingress correlation binding.
 *
 * auth-proxy is the single mint point for the request correlation id (ADR-054):
 * an inbound `X-Request-Id` (or, tolerantly, `X-Correlation-Id`) is reused
 * verbatim; a UUID is minted only when neither is present — the mint-once
 * invariant downstream services rely on (they never re-mint). The id is bound
 * for the whole request via `AsyncLocalStorage`, so `createLogger` surfaces it
 * as `attributes.correlation_id` on every line and the upstream-forward helpers
 * carry it on `X-Request-Id` to every hop, all without signature threading.
 */

import { randomUUID } from "node:crypto";

import { runWithCorrelationId } from "@dashboard-chat/correlation-id";
import { echoCorrelationId } from "@dashboard-chat/correlation-id/hono";
import type { Context, Next } from "hono";

import { createLogger } from "./log.ts";

const log = createLogger("proxy");

/**
 * Mint-once predicate: reuse an inbound id verbatim, mint only when absent.
 * Pure and header-getter-shaped so the present→reuse / absent→mint contract is
 * unit-testable without standing up Hono.
 */
export function resolveCorrelationId(headers: {
  get(name: string): string | null;
}): { id: string; minted: boolean } {
  const inbound = headers.get("x-request-id") || headers.get("x-correlation-id");
  if (inbound) return { id: inbound, minted: false };
  return { id: randomUUID(), minted: true };
}

/**
 * Ingress middleware: resolve the correlation id once and run the entire
 * downstream handler inside its `AsyncLocalStorage` scope, so every log line and
 * every upstream forward for this request shares the one id. Emits a single
 * request line on the way out, guaranteeing at least one auth-proxy log line
 * carries the id for every request.
 */
export async function correlationMiddleware(c: Context, next: Next): Promise<void> {
  const { id, minted } = resolveCorrelationId(c.req.raw.headers);
  await runWithCorrelationId(id, async () => {
    try {
      await next();
    } finally {
      log.info("request.handled", {
        method: c.req.method,
        path: c.req.path,
        status: c.res?.status,
        correlation_minted: minted,
      });
    }
  });
  // Echo the id on every response (incl. error responses) so the operator can
  // copy it straight from the failure (AC1.3).
  echoCorrelationId(c, id);
}
