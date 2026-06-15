// Server-side downstream client for the agent, reached through auth-proxy's
// `/worker/*` prefix. Runs ONLY in RRv7 server loaders/actions (the ui/ BFF) —
// the first step of the SSR-as-BFF progression (docs/feature/ssr-bff-gateway).
//
// It reads the inbound USER credential off the Request (`cookie` + `authorization`)
// and FORWARDS it to auth-proxy, which re-verifies the session and injects
// X-User-Id / X-Org-Id downstream. M2M on-behalf-of is deferred (DWD-2); this slice
// forwards the user credential.
//
// The credential-forwarding + auth-proxy-fetch logic now lives in the ONE shared
// forwarding primitive `proxy-fetch.ts` (decision #4): `agentFetch` is a thin
// `/worker`-prefixed wrapper over `proxyFetch`, sharing exactly the same cookie→
// Bearer hop as the `/api` client (`api-client.ts`) — no duplicated cookie-copy
// logic. The raw upstream Response is returned unmodified so the caller decides how
// to consume it — `.json()` for /worker/health, or an un-buffered
// `new Response(upstream.body)` passthrough for the /worker/chat SSE relay (DWD-3).
import { proxyFetch, type ProxyFetchOptions } from "./proxy-fetch";

/** The prefix auth-proxy strips before proxying to the agent container. */
const WORKER_PREFIX = "/worker";

export type AgentFetchOptions = ProxyFetchOptions;

/**
 * Fetch `auth-proxy + /worker + <path>` server-side, forwarding the inbound user
 * credential via the shared primitive. Returns the raw upstream Response (no body
 * read).
 */
export async function agentFetch(
  request: Request,
  path: string,
  options: AgentFetchOptions = {},
): Promise<Response> {
  return proxyFetch(request, WORKER_PREFIX, path, options);
}
