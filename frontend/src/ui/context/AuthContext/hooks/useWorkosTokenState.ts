import { type Dispatch, type SetStateAction, useEffect, useState } from "react";

import { ensureFreshToken } from "@/auth/tokenRefresh";
import {
  getRefreshToken,
  getToken,
  getTokenExpiry,
  getUser,
  isExpiryKey,
  isTokenKey,
} from "@/auth/tokenStorage";
import type { AuthState, TokenStateResult } from "@/auth/types";

// --- Proactive refresh policy ---
const REFRESH_AT_TTL_FRACTION = 0.8;
const MIN_REFRESH_DELAY_MS = 10_000;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [30_000, 60_000] as const;

function syncTokenState(newToken: string, setState: Dispatch<SetStateAction<AuthState>>) {
  setState(prev => ({
    ...prev,
    token: newToken,
    refreshToken: getRefreshToken(),
    tokenExpiresAt: getTokenExpiry(),
  }));
}

function useRestoreSession(setState: Dispatch<SetStateAction<AuthState>>) {
  useEffect(() => {
    const token = getToken();
    const user = getUser();
    if (token && user) {
      const refreshToken = getRefreshToken();
      const tokenExpiresAt = getTokenExpiry();
      setState({ user, token, refreshToken, tokenExpiresAt, isAuthenticated: true, isLoading: false });
    } else {
      setState(s => ({ ...s, isLoading: false }));
    }
  }, [setState]);
}

function useProactiveRefresh(state: AuthState, setState: Dispatch<SetStateAction<AuthState>>) {
  useEffect(() => {
    if (!state.tokenExpiresAt || !state.isAuthenticated) return;

    const ttl = state.tokenExpiresAt - Date.now();
    const delay = Math.max(ttl * REFRESH_AT_TTL_FRACTION, MIN_REFRESH_DELAY_MS);

    let retryTimerId: ReturnType<typeof setTimeout> | null = null;
    let attemptCount = 0;

    const attemptRefresh = async (): Promise<void> => {
      attemptCount++;
      const newToken = await ensureFreshToken().catch(() => null);

      if (newToken) {
        syncTokenState(newToken, setState);
        return;
      }

      if (attemptCount < MAX_RETRY_ATTEMPTS) {
        const retryDelay = RETRY_DELAYS_MS[attemptCount - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
        console.warn(`[auth] Proactive refresh failed (attempt ${attemptCount}/${MAX_RETRY_ATTEMPTS}), retrying in ${retryDelay / 1000}s`);
        retryTimerId = setTimeout(attemptRefresh, retryDelay);
      } else {
        console.warn("[auth] Proactive refresh exhausted all retries, stopping");
      }
    };

    const timerId = setTimeout(attemptRefresh, delay);
    return () => {
      clearTimeout(timerId);
      if (retryTimerId) clearTimeout(retryTimerId);
    };
  }, [state.tokenExpiresAt, state.isAuthenticated, setState]);
}

function useCrossTabSync(state: AuthState, setState: Dispatch<SetStateAction<AuthState>>) {
  useEffect(() => {
    if (!state.isAuthenticated) return;

    const handleStorageChange = (e: StorageEvent) => {
      const tokenRefreshedInAnotherTab = isExpiryKey(e.key) && e.newValue;
      const loggedOutInAnotherTab = isTokenKey(e.key) && !e.newValue;

      if (tokenRefreshedInAnotherTab) {
        const token = getToken();
        const refreshToken = getRefreshToken();
        const tokenExpiresAt = Number(e.newValue);
        if (token) {
          setState(prev => ({ ...prev, token, refreshToken, tokenExpiresAt }));
        }
      } else if (loggedOutInAnotherTab) {
        setState({
          user: null, token: null, refreshToken: null, tokenExpiresAt: null,
          isAuthenticated: false, isLoading: false,
        });
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [state.isAuthenticated, setState]);
}

export function useWorkosTokenState(): TokenStateResult {
  const [state, setState] = useState<AuthState>({
    user: null, token: null, refreshToken: null, tokenExpiresAt: null, isAuthenticated: false, isLoading: true,
  });

  useRestoreSession(setState);
  useProactiveRefresh(state, setState);
  useCrossTabSync(state, setState);

  return { state, setState };
}
