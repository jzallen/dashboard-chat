// Shared HTTP-transport substrate for the ui-state flow app: the centralized
// request-id minting middleware. The live app is driven by the ChatApp
// coordinator actor, whose router (`lib/machines/chat-app/router.ts`) owns the
// single `/state` actor surface (`/state` + `/state/events` + `/state/stream`)
// and serves no freeze/thaw — auth-proxy owns the token lifecycle.
//
// References:
//   docs/decisions/adr-016-*.md                     — auth-proxy owns token lifecycle
//   docs/research/hono-request-id-middleware.md      — request-id minting policy

import { requestId } from "hono/request-id";

/**
 * The single request-id minting policy for the ui-state flow app. Hono's
 * first-party middleware honors an inbound `X-Request-Id` header when present,
 * mints a UUID otherwise, exposes it via `c.get("requestId")`, and echoes it on
 * the response — so successive `/state` calls of a request no longer mint
 * divergent ids on a header-less call. `globalThis.crypto` exposes `randomUUID`
 * on Node 19+; `req-<epoch>` is the crypto-less fallback.
 */
export const requestIdMiddleware = requestId({
  headerName: "X-Request-Id",
  generator: () => globalThis.crypto?.randomUUID?.() ?? `req-${Date.now()}`,
});
