/**
 * Server-side authenticated `/api` client, reached through auth-proxy's `/api/*`
 * prefix. Runs ONLY in RRv7 server loaders/actions (the ui/ BFF) — the cookie→Bearer
 * hop for the backend `/api` upstream, sibling of the agent's `/worker` hop
 * ({@link agentFetch}). Both share the one forwarding primitive {@link proxyFetch} —
 * no duplicated cookie-copy logic.
 *
 * {@link apiFetch} returns the raw upstream Response (no body read, no
 * `credentials:"include"` browser fetch). On a 401 the route surfaces an
 * unauthenticated signal it turns into a `/login` redirect — see
 * {@link ApiUnauthenticatedError} / {@link assertAuthenticated}.
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
