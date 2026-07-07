/**
 * Server-side authenticated `/api` client, reached through auth-proxy's `/api/*`
 * prefix. Runs ONLY in RRv7 server loaders/actions (the ui-server) — the cookie→Bearer
 * hop for the backend `/api` upstream, sibling of the agent's `/worker` hop
 * ({@link agentFetch}). Both share the one forwarding primitive {@link proxyFetch} —
 * no duplicated cookie-copy logic.
 *
 * {@link apiFetch} returns the raw upstream Response (no body read, no
 * `credentials:"include"` browser fetch). On a 401 the route surfaces an
 * unauthenticated signal it turns into a `/login` redirect — see
 * {@link ApiUnauthenticatedError} / {@link assertAuthenticated}.
 *
 * Auth-transport contract: this module is the SERVER leg of a two-transport
 * split. The inbound `Request` carries the user's cookie; {@link proxyFetch}
 * extracts it and mints a downstream Bearer token for the backend. The
 * BROWSER leg is {@link gatewayGet} / {@link gatewayPatch} / {@link gatewayPost}
 * in `gateway-client.ts`, which sends the cookie directly via
 * `credentials:"include"` and never builds an Authorization header. Both are
 * correct for their runtime context — server loader vs. browser fetch —
 * and must not be mixed.
 */
import { proxyFetch, type ProxyFetchOptions } from "./proxy-fetch";

/** The prefix auth-proxy strips before proxying to the backend `/api` upstream. */
const API_PREFIX = "/api";

/**
 * Thrown when an `/api` call comes back 401. A loader catches it and turns it into
 * a redirect to `/login` — the unauthenticated signal.
 */
export class ApiUnauthenticatedError extends Error {
  constructor(message = "Unauthenticated: auth-proxy returned 401") {
    super(message);
    this.name = "ApiUnauthenticatedError";
  }
}

/**
 * Fetch `auth-proxy + /api + <path>` server-side, forwarding the inbound user
 * credential via the shared primitive. Returns the raw upstream Response.
 */
export async function apiFetch(
  request: Request,
  path: string,
  options: ProxyFetchOptions = {},
): Promise<Response> {
  return proxyFetch(request, API_PREFIX, path, options);
}

/**
 * Surface the unauthenticated signal: throw {@link ApiUnauthenticatedError} when
 * the upstream responded 401, otherwise return the Response unchanged so the
 * loader can keep consuming it.
 */
export function assertAuthenticated(response: Response): Response {
  if (response.status === 401) throw new ApiUnauthenticatedError();
  return response;
}
