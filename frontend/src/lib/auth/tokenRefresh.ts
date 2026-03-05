import { API_BASE_URL } from "../shared/config";
import { getRefreshToken, getToken, getTokenExpiry, setRefreshToken, setToken, setTokenExpiry } from "./tokenStorage";

const FRESHNESS_THRESHOLD_MS = 60_000;
const RATE_LIMIT_RETRY_DELAY_MS = 12_000;

interface RefreshResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

type RefreshResult =
  | { ok: true; data: RefreshResponse }
  | { ok: false; status: number };

async function doRefresh(token: string): Promise<RefreshResult> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: token }),
    });
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, data: await response.json() };
  } catch {
    return { ok: false, status: 0 };
  }
}

function applyTokens(data: RefreshResponse): string {
  setToken(data.access_token);
  setRefreshToken(data.refresh_token);
  setTokenExpiry(Date.now() + data.expires_in * 1000);
  console.debug("[auth] Token refresh successful, expires_in:", data.expires_in);
  return data.access_token;
}

async function performRefresh(refreshToken: string): Promise<string | null> {
  // Freshness guard: skip refresh if token is still valid
  const expiresAt = getTokenExpiry();
  if (expiresAt && expiresAt - Date.now() > FRESHNESS_THRESHOLD_MS) {
    return getToken();
  }

  const result = await doRefresh(refreshToken);

  if (result.ok) return applyTokens(result.data);

  // Only retry on 429 (rate limit)
  if (result.status !== 429) {
    console.warn("[auth] Token refresh failed with status:", result.status);
    return null;
  }

  console.warn("[auth] Rate-limited (429), retrying after delay");
  await new Promise(r => setTimeout(r, RATE_LIMIT_RETRY_DELAY_MS));
  const retryToken = getRefreshToken();
  if (!retryToken) return null;

  const retryResult = await doRefresh(retryToken);
  if (retryResult.ok) return applyTokens(retryResult.data);

  console.error("[auth] Token refresh failed after 429 retry:", retryResult.status);
  return null;
}

/**
 * Creates a token refresher with closure-scoped promise coalescing.
 * Multiple concurrent callers share a single in-flight refresh request.
 */
export function createTokenRefresher() {
  let refreshPromise: Promise<string | null> | null = null;

  return async function ensureFreshToken(): Promise<string | null> {
    console.debug("[auth] Starting token refresh");

    const refreshToken = getRefreshToken();
    if (!refreshToken) {
      console.warn("[auth] No refresh token available");
      return null;
    }

    if (refreshPromise) return refreshPromise;

    refreshPromise = performRefresh(refreshToken).finally(() => { refreshPromise = null; });

    return refreshPromise;
  };
}

/** Default instance for production use. */
export const ensureFreshToken = createTokenRefresher();
