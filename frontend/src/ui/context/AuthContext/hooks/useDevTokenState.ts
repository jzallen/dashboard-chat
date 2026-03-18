import { useEffect, useState } from "react";

import {
  setRefreshToken,
  setToken,
  setTokenExpiry,
  setUser,
} from "@/auth/tokenStorage";
import type { AuthState, AuthUser, TokenStateResult } from "@/auth/types";
import { DATA_CATALOG_BASE_URL } from "@/http/config";

export function useDevTokenState(): TokenStateResult {
  const [state, setState] = useState<AuthState>({
    user: null, token: null, refreshToken: null, tokenExpiresAt: null, isAuthenticated: false, isLoading: true,
  });

  useEffect(() => {
    let cancelled = false;

    async function fetchDevToken() {
      try {
        const res = await fetch(`${DATA_CATALOG_BASE_URL}/api/auth/callback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: "dev-auth-code" }),
        });

        if (!res.ok) throw new Error(`callback returned ${res.status}`);
        if (cancelled) return;

        const data = await res.json() as {
          token: string;
          user: AuthUser;
          refresh_token: string;
          expires_in: number;
        };

        const expiresAt = Date.now() + data.expires_in * 1000;

        setToken(data.token);
        setUser(data.user);
        setRefreshToken(data.refresh_token);
        setTokenExpiry(expiresAt);

        setState({
          user: data.user,
          token: data.token,
          refreshToken: data.refresh_token,
          tokenExpiresAt: expiresAt,
          isAuthenticated: true,
          isLoading: false,
        });
      } catch (err) {
        console.error("Failed to fetch dev token:", err);
        if (!cancelled) {
          setState((prev) => ({ ...prev, isLoading: false }));
        }
      }
    }

    fetchDevToken();
    return () => { cancelled = true; };
  }, []);

  return { state, setState };
}
