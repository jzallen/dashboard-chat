/**
 * agentFetch — the server-side authenticated client for the agent worker, reached
 * through auth-proxy's `/worker/*` prefix. Runs ONLY in RRv7 server loaders/actions
 * (the ui/ BFF).
 *
 * A thin `/worker`-prefixed wrapper over the shared {@link proxyFetch} primitive:
 * it forwards the inbound USER credential (`cookie` + `authorization`) to
 * auth-proxy, which re-verifies the session and injects X-User-Id / X-Org-Id
 * downstream. Routing through the shared primitive means it uses exactly the same
 * cookie→Bearer hop as the `/api` client ({@link apiFetch}) — no duplicated
 * cookie-copy logic.
 *
 * The raw upstream Response is returned unmodified so the caller decides how to
 * consume it — `.json()` for `/worker/health`, or an un-buffered
 * `new Response(upstream.body)` passthrough for the `/worker/chat` SSE relay.
 */
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
