// The ONE shared server-side forwarding primitive (decision #4): both downstream
// hops — the agent's `/worker/*` (`agent-client.ts`) and the new `/api/*`
// (`api-client.ts`) — proxy through auth-proxy via this single function, so the
// cookie→Bearer credential-forwarding logic lives in exactly one place.
//
// Runs ONLY in RRv7 server loaders/actions (the ui/ BFF). It reads the inbound
// USER credential off the Request (`cookie` + `authorization`) and FORWARDS it to
// auth-proxy, which re-verifies the session and injects X-User-Id / X-Org-Id
// downstream. The raw upstream Response is returned unmodified (no body read) so
// the caller decides how to consume it.
//
// SKELETON (DC-16): signatures only. `proxyFetch` is stubbed and throws; the impl
// task (DC-17, AC3) lifts the real forwarding logic here from `agent-client.ts`
// and refactors `agentFetch` onto it.

/** The auth-proxy origin. In dev (vite) this is http://localhost:1042; in compose
 *  it is the in-network auth-proxy service. Read lazily (not at module-eval) so a
 *  late-injected server env is honoured. Server-side only — never shipped to the
 *  browser. */
export function authProxyUrl(): string {
  return process.env.AUTH_PROXY_URL ?? "http://auth-proxy:3000";
}

export interface ProxyFetchOptions {
  method?: string;
  body?: BodyInit | null;
  /** Extra headers (e.g. content-type). Inbound credential headers are merged in
   *  and take effect only when not already set here. */
  headers?: HeadersInit;
  /** Bound the request with an AbortController. OMIT for long-lived streams (the
   *  chat SSE relay) — a timeout there would truncate a legitimate long turn. */
  timeoutMs?: number;
}

/** Copy the inbound user credential (cookie + authorization) onto the outbound
 *  headers without clobbering anything the caller set explicitly. */
export function withForwardedCredential(
  _request: Request,
  _headers: Headers,
): Headers {
  throw new Error("not implemented");
}

/**
 * Fetch `authProxyUrl() + <prefix> + <path>` server-side, forwarding the inbound
 * user credential. Returns the raw upstream Response (no body read). Honours an
 * optional `timeoutMs` via AbortController.
 */
export async function proxyFetch(
  _request: Request,
  _prefix: string,
  _path: string,
  _options: ProxyFetchOptions = {},
): Promise<Response> {
  throw new Error("not implemented");
}
