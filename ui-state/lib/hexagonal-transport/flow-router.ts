// Shared HTTP-transport substrate for the ui-state flow app: the centralized
// request-id minting middleware. The live app is driven by the ChatApp
// coordinator actor, whose router (`lib/machines/chat-app/router.ts`) owns the
// single `/state` actor surface (`/state` + `/state/events` + `/state/stream`)
// and serves no freeze/thaw — auth-proxy owns the token lifecycle.
//
// References:
//   docs/decisions/adr-016-*.md                     — auth-proxy owns token lifecycle
//   docs/research/hono-request-id-middleware.md      — request-id minting policy

import { runWithCorrelationId } from "@dashboard-chat/correlation-id";
import { createMiddleware } from "hono/factory";
import { requestId } from "hono/request-id";

/**
 * Hono's first-party request-id policy: honor an inbound `X-Request-Id` when
 * present, mint a UUID otherwise, expose it via `c.get("requestId")`, and echo
 * it on the response. `globalThis.crypto` exposes `randomUUID` on Node 19+;
 * `req-<epoch>` is the crypto-less fallback.
 */
const baseRequestId = requestId({
  headerName: "X-Request-Id",
  generator: () => globalThis.crypto?.randomUUID?.() ?? `req-${Date.now()}`,
});

/**
 * The single request-id middleware for the ui-state flow app. Extends the Hono
 * policy above to ALSO bind the resolved id into the shared `AsyncLocalStorage`
 * correlation store, so the logger surfaces it as `attributes.correlation_id`
 * and the Redis `FlowEventRecord.request_id` (read from `c.get("requestId")`)
 * stays aligned to the same id — one id across logs, persistence, and the wire.
 */
export const requestIdMiddleware = createMiddleware(async (c, next) => {
  await baseRequestId(c, async () => {
    const id = c.get("requestId") ?? "";
    await runWithCorrelationId(id, () => next());
  });
});
