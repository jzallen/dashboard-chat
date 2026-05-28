import { ensureFreshToken } from "./tokenRefresh";
import {
  getAuthHeaders,
  getTokenExpiry,
  hardLogout,
  setToken,
  setTokenExpiry,
} from "./tokenStorage";

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const EAGER_REFRESH_THRESHOLD_MS = 60_000;

/**
 * Consume a server-driven token reissue carried on a response (Stage 2 of
 * auth-proxy-mints-user-tokens). auth-proxy mints a fresh user token on
 * org-create and relays it as `X-New-Access-Token` (+ `X-New-Token-Expires-In`,
 * a TTL in seconds). Only auth-proxy can set these headers — it strips any
 * upstream-supplied values. When present and non-empty we adopt the new token
 * via the existing storage primitives; no separate reissue round-trip.
 */
function consumeReissuedToken(response: Response): void {
  // Defensive: withAuth wraps arbitrary fetch fns; inspecting an optional
  // header must never crash the request if the response lacks a headers bag.
  const newToken = response?.headers?.get?.("X-New-Access-Token");
  if (!newToken || !newToken.trim()) return;

  setToken(newToken);
  const expiresIn = Number(response.headers.get("X-New-Token-Expires-In"));
  if (Number.isFinite(expiresIn) && expiresIn > 0) {
    setTokenExpiry(Date.now() + expiresIn * 1000);
  }
}

/**
 * Wraps a fetch function with auth header injection and transparent 401 recovery.
 *
 * Injects the current bearer token from localStorage into every request.
 * If the server responds with 401, refreshes the token and replays the
 * request once. Calls hardLogout on unrecoverable auth failures.
 *
 * Use for standard request/response calls (REST APIs) where replay is safe.
 */
export function withAuth(fetchFn: FetchFn): FetchFn {
  return async (input, init) => {
    const headers = { ...getAuthHeaders(), ...init?.headers };
    const mergedInit = { ...init, headers };

    let response = await fetchFn(input, mergedInit);

    if (response.status === 401) {
      const newToken = await ensureFreshToken();
      if (!newToken) {
        hardLogout();
        throw new Error("Session expired");
      }
      const retryHeaders = { ...init?.headers, Authorization: `Bearer ${newToken}` };
      response = await fetchFn(input, { ...init, headers: retryHeaders });

      if (response.status === 401) {
        hardLogout();
        throw new Error("Session expired");
      }
    }

    consumeReissuedToken(response);
    return response;
  };
}

/**
 * Wraps a fetch function with eager token refresh before the request,
 * plus the same 401 recovery as {@link withAuth}.
 *
 * If the token expires within 60 seconds, refreshes it proactively so the
 * request starts with a valid token. This avoids mid-flight 401s for
 * long-lived connections (SSE streams, file downloads) that cannot be
 * transparently replayed.
 *
 * Falls back to withAuth's 401 retry if the eager refresh wasn't sufficient.
 */
export function withEagerAuth(fetchFn: FetchFn): FetchFn {
  const authedFetch = withAuth(fetchFn);
  return async (input, init) => {
    const expiresAt = getTokenExpiry();
    if (expiresAt && expiresAt - Date.now() < EAGER_REFRESH_THRESHOLD_MS) {
      await ensureFreshToken().catch(() => {
        // Proceed with existing token; withAuth's 401 handler will catch it
      });
    }
    return authedFetch(input, init);
  };
}
