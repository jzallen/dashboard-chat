/**
 * proxyFetch — the one shared server-side credential-forwarding primitive. Both
 * downstream hops — the agent's `/worker/*` ({@link agentFetch} in
 * `agent-client.ts`) and the backend's `/api/*` ({@link apiFetch} in
 * `api-client.ts`) — proxy through auth-proxy via this single function, so the
 * cookie→Bearer forwarding logic lives in exactly one place.
 *
 * Runs ONLY in RRv7 server loaders/actions (the ui/ BFF): it reads the inbound
 * USER credential off the Request (`cookie` + `authorization`) and forwards it to
 * auth-proxy, which re-verifies the session and injects X-User-Id / X-Org-Id
 * downstream. The raw upstream Response is returned unmodified (no body read) so
 * the caller decides how to consume it.
 */

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
  request: Request,
  headers: Headers,
): Headers {
  const cookie = request.headers.get("cookie");
  if (cookie && !headers.has("cookie")) headers.set("cookie", cookie);
  const authorization = request.headers.get("authorization");
  if (authorization && !headers.has("authorization")) {
    headers.set("authorization", authorization);
  }
  return headers;
}

/**
 * Fetch `authProxyUrl() + <prefix> + <path>` server-side, forwarding the inbound
 * user credential. Returns the raw upstream Response (no body read). Honours an
 * optional `timeoutMs` via AbortController.
 */
export async function proxyFetch(
  request: Request,
  prefix: string,
  path: string,
  options: ProxyFetchOptions = {},
): Promise<Response> {
  const { method = "GET", body = null, headers, timeoutMs } = options;
  const url = new URL(`${prefix}${path}`, authProxyUrl());
  const outboundHeaders = withForwardedCredential(
    request,
    new Headers(headers),
  );

  const init: RequestInit = { method, headers: outboundHeaders };
  if (body !== null) init.body = body;

  if (timeoutMs === undefined) {
    return fetch(url, init);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
