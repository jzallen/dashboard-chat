// Shared HTTP-transport substrate for the ui-state flow app.
//
// Post-ADR-044 Phase 4 this module holds only the centralized request-id
// minting middleware — the strategy-agnostic routes (`/freeze`, `/thaw`,
// `/projection`, `/projection/stream`) and the `resultToJson` /
// `freezeThawHandler` helpers were retired with the FlowOrchestrator: the live
// app is now driven by the ChatApp coordinator actor, whose router
// (`lib/machines/chat-app/router.ts`) owns its own `/projection` +
// `/projection/stream` (derived views) and serves no freeze/thaw (ADR-043 —
// auth-proxy owns the token lifecycle).

import { requestId } from "hono/request-id";

/**
 * The single request-id minting policy for the ui-state flow app
 * (research: docs/research/hono-request-id-middleware.md). Hono's first-party
 * middleware honors an inbound `X-Request-Id` header when present, mints a UUID
 * otherwise, exposes it via `c.get("requestId")`, and echoes it on the
 * response — so `/begin` and `/event` of a request no longer mint divergent ids
 * on a header-less call. `globalThis.crypto` exposes `randomUUID` on Node 19+;
 * `req-<epoch>` is the crypto-less fallback.
 */
export const requestIdMiddleware = requestId({
  headerName: "X-Request-Id",
  generator: () => globalThis.crypto?.randomUUID?.() ?? `req-${Date.now()}`,
});
