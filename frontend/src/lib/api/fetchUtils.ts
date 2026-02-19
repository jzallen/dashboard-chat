/**
 * Shared fetch utilities for API and chat worker clients.
 */

export const TOKEN_KEY = "auth_token";
export const REFRESH_TOKEN_KEY = "auth_refresh_token";
export const EXPIRES_AT_KEY = "auth_token_expires_at";
export const ACTIVITY_KEY = "last_activity_ts";

const API_URL = import.meta.env.VITE_API_URL || "";

class RefreshError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Clear all auth state and redirect to login.
 */
export function hardLogout(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem("auth_user");
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(EXPIRES_AT_KEY);
  localStorage.removeItem(ACTIVITY_KEY);
  window.location.href = "/login";
}

/**
 * Coalesced token refresh. Multiple concurrent callers share a single
 * in-flight refresh request. Returns the new access token on success,
 * or null if no refresh token is available.
 */
let refreshPromise: Promise<string | null> | null = null;

/** @internal Reset module state between tests. */
export function _resetRefreshState(): void {
  refreshPromise = null;
}

export async function ensureFreshToken(): Promise<string | null> {
  console.debug("[auth] Starting token refresh");

  const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
  if (!refreshToken) {
    console.warn("[auth] No refresh token available");
    return null;
  }

  if (refreshPromise) return refreshPromise;

  refreshPromise = (async (): Promise<string | null> => {
    // 1.2 Freshness guard: skip refresh if token is still valid for >60s
    const expiresAt = Number(localStorage.getItem(EXPIRES_AT_KEY));
    if (expiresAt && expiresAt - Date.now() > 60_000) {
      return localStorage.getItem(TOKEN_KEY);
    }

    const doRefresh = async (token: string) => {
      const response = await fetch(`${API_URL}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: token }),
      });
      if (!response.ok) throw new RefreshError("Refresh failed", response.status);
      return response.json();
    };

    const applyTokens = (data: { access_token: string; refresh_token: string; expires_in: number }) => {
      localStorage.setItem(TOKEN_KEY, data.access_token);
      localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token);
      localStorage.setItem(EXPIRES_AT_KEY, String(Date.now() + data.expires_in * 1000));
      console.debug("[auth] Token refresh successful, expires_in:", data.expires_in);
      return data.access_token;
    };

    try {
      return applyTokens(await doRefresh(refreshToken));
    } catch (err) {
      console.warn("[auth] First refresh attempt failed:", err);
      // Single retry with delay (12s for 429, 5s otherwise)
      const retryDelay = err instanceof RefreshError && err.status === 429 ? 12_000 : 5_000;
      try {
        await new Promise(r => setTimeout(r, retryDelay));
        const retryToken = localStorage.getItem(REFRESH_TOKEN_KEY);
        if (!retryToken) return null;
        return applyTokens(await doRefresh(retryToken));
      } catch (err) {
        console.error("[auth] Token refresh failed after retry:", err);
        return null;
      }
    }
  })().finally(() => { setTimeout(() => { refreshPromise = null; }, 500); });

  return refreshPromise;
}

/**
 * Handle 401 responses by refreshing the token and replaying the request.
 * Returns the (possibly retried) response for further processing.
 * Calls hardLogout and throws on unrecoverable 401.
 */
export async function withAuthRetry(
  response: Response,
  url: string,
  init: RequestInit,
  isRetry = false,
): Promise<Response> {
  if (response.status === 401 && !isRetry) {
    const newToken = await ensureFreshToken();
    if (newToken) {
      const retryResponse = await fetch(url, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${newToken}` },
      });
      return withAuthRetry(retryResponse, url, init, true);
    }
    hardLogout();
    throw new Error("Session expired");
  }
  if (response.status === 401 && isRetry) {
    hardLogout();
    throw new Error("Session expired");
  }
  return response;
}

/**
 * Generic response handler with 401 → refresh → replay.
 * Pass the original url and init so the request can be replayed after token refresh.
 */
export async function handleResponse<T>(
  response: Response,
  url: string,
  init: RequestInit,
): Promise<T> {
  const res = await withAuthRetry(response, url, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Request failed (${res.status}): ${text}`);
  }
  return res.json();
}
