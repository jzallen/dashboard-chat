// Server-side downstream client for the agent, reached through auth-proxy's
// `/worker/*` prefix. Runs ONLY in RRv7 server loaders/actions (the ui/ BFF) —
// the first step of the SSR-as-BFF progression (docs/feature/ssr-bff-gateway).
//
// Mirrors frontend/app/lib/ui-state-client.ts: it reads the inbound USER
// credential off the Request (`cookie` + `authorization`) and FORWARDS it to
// auth-proxy, which re-verifies the session and injects X-User-Id / X-Org-Id
// downstream. M2M on-behalf-of is deferred (DWD-2); this slice forwards the user
// credential, mirroring the ui-state-client precedent.
//
// The raw upstream Response is returned unmodified so the caller decides how to
// consume it — `.json()` for /worker/health, or an un-buffered
// `new Response(upstream.body)` passthrough for the /worker/chat SSE relay
// (DWD-3). Do NOT read the body here.

/** The auth-proxy origin. In dev (vite) this is http://localhost:1042; in compose
 *  it is the in-network auth-proxy service. Read lazily (not at module-eval) so a
 *  late-injected server env is honoured. Server-side only — never shipped to the
 *  browser. */
function authProxyUrl(): string {
  return process.env.AUTH_PROXY_URL ?? "http://auth-proxy:3000";
}

/** The prefix auth-proxy strips before proxying to the agent container. */
const WORKER_PREFIX = "/worker";

export interface AgentFetchOptions {
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
function withForwardedCredential(request: Request, headers: Headers): Headers {
  const cookie = request.headers.get("cookie");
  if (cookie && !headers.has("cookie")) headers.set("cookie", cookie);
  const authorization = request.headers.get("authorization");
  if (authorization && !headers.has("authorization")) {
    headers.set("authorization", authorization);
  }
  return headers;
}

/**
 * Fetch `auth-proxy + /worker + <path>` server-side, forwarding the inbound user
 * credential. Returns the raw upstream Response (no body read).
 */
export async function agentFetch(
  request: Request,
  path: string,
  options: AgentFetchOptions = {},
): Promise<Response> {
  const { method = "GET", body = null, headers, timeoutMs } = options;
  const url = new URL(`${WORKER_PREFIX}${path}`, authProxyUrl());
  const outboundHeaders = withForwardedCredential(request, new Headers(headers));

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
