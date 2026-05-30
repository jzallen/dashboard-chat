import { createContext, type ReactNode, useCallback, useContext } from "react";

import {
  clearAll,
  getToken,
  setToken,
  setTokenExpiry,
  setUser,
} from "@/auth/tokenStorage";
import type { AuthState, AuthUser } from "@/auth/types";
import { ApiClient } from "@/http/apiClient";
import { DATA_CATALOG_BASE_URL } from "@/http/config";

import { ActivityCheckModal } from "../../components/ActivityCheckModal";
import { ActivityDebugBadge } from "../../components/ActivityDebugBadge";
import { useInactivity } from "./hooks/useInactivity";
import { useTokenState } from "./hooks/useTokenState";

// Auth bootstrap client uses plain fetch (no auth wrapper — these are pre-auth endpoints)
const authClient = new ApiClient(DATA_CATALOG_BASE_URL, { unwrapData: true });

// Identity claims carried by the auth-proxy-minted JWT access token.
interface UserClaims {
  sub?: string;
  email?: string;
  org_id?: string;
  name?: string;
}

// Read (not verify) the JWT payload. The auth-proxy already signed and verified
// it; the client only needs the identity claims it carries. Client-only — runs
// in the /auth/callback effect, never during SSR.
function decodeJwtPayload(token: string): UserClaims {
  try {
    const part = token.split(".")[1] ?? "";
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as UserClaims;
  } catch {
    return {};
  }
}

interface AuthContextValue extends AuthState {
  login: (organizationId?: string) => Promise<void>;
  logout: () => void;
  handleCallback: (code: string, state?: string) => Promise<AuthUser>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { state, setState } = useTokenState();

  const login = useCallback(async (organizationId?: string) => {
    const params = organizationId
      ? `?organization_id=${encodeURIComponent(organizationId)}`
      : "";
    const { url, state } = await authClient.get<{ url: string; state: string }>(
      `/api/auth/login${params}`,
    );
    if (state) {
      sessionStorage.setItem("oauth_state", state);
    }
    window.location.href = url;
  }, []);

  const handleCallback = useCallback(
    async (code: string, state?: string): Promise<AuthUser> => {
      // The auth-proxy mints a JWT access token whose claims (sub/email/org_id)
      // ARE the user identity; the WorkOS refresh token is held server-side and
      // never returned (session/sid model — see auth-proxy app.ts). The CSRF
      // `state` is echoed back so the proxy can consume the value it remembered
      // at /api/auth/login.
      const { access_token, expires_in } = await authClient.post<{
        access_token: string;
        expires_in: number;
      }>("/api/auth/callback", { code, state });
      const claims = decodeJwtPayload(access_token);
      const user: AuthUser = {
        id: claims.sub ?? "",
        email: claims.email ?? "",
        org_id: claims.org_id ? claims.org_id : null,
        name: claims.name ?? null,
      };
      const expiresAt = Date.now() + expires_in * 1000;
      setToken(access_token);
      setUser(user);
      setTokenExpiry(expiresAt);
      setState({
        user,
        token: access_token,
        refreshToken: null,
        tokenExpiresAt: expiresAt,
        isAuthenticated: true,
        isLoading: false,
      });
      return user;
    },
    [setState],
  );

  const logout = useCallback(() => {
    const token = getToken();
    if (token) {
      fetch(`${DATA_CATALOG_BASE_URL}/api/auth/logout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      }).catch(() => {
        // Revocation failure is non-fatal
      });
    }

    clearAll();
    setState({
      user: null,
      token: null,
      refreshToken: null,
      tokenExpiresAt: null,
      isAuthenticated: false,
      isLoading: false,
    });
  }, [setState]);

  const { showModal, handleContinue, handleLogout } = useInactivity(
    state.isAuthenticated,
    logout,
  );

  return (
    <AuthContext.Provider value={{ ...state, login, logout, handleCallback }}>
      {children}
      <ActivityCheckModal
        isOpen={showModal}
        onContinue={handleContinue}
        onLogout={handleLogout}
      />
      {import.meta.env.VITE_DEBUG_ACTIVITY === "true" && <ActivityDebugBadge />}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
