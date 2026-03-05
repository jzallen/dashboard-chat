import { createContext, type ReactNode, useCallback, useContext } from "react";

import { clearAll, getToken, setRefreshToken, setToken, setTokenExpiry, setUser } from "../../../auth/tokenStorage";
import type { AuthState, AuthUser } from "../../../auth/types";
import { backendClient } from "../../../dataCatalog/client";
import { API_BASE_URL } from "../../../shared/config";
import { ActivityCheckModal } from "../../components/ActivityCheckModal";
import { ActivityDebugBadge } from "../../components/ActivityDebugBadge";
import { useInactivity } from "./hooks/useInactivity";
import { useTokenState } from "./hooks/useTokenState";

interface AuthContextValue extends AuthState {
  login: (organizationId?: string) => Promise<void>;
  logout: () => void;
  handleCallback: (code: string) => Promise<AuthUser>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { state, setState } = useTokenState();

  const login = useCallback(async (organizationId?: string) => {
    const params = organizationId ? `?organization_id=${encodeURIComponent(organizationId)}` : "";
    const { url, state } = await backendClient.get<{ url: string; state: string }>(`/api/auth/login${params}`);
    if (state) {
      sessionStorage.setItem("oauth_state", state);
    }
    window.location.href = url;
  }, []);

  const handleCallback = useCallback(async (code: string): Promise<AuthUser> => {
    const data = await backendClient.post<{ user: AuthUser; token: string; refresh_token: string; expires_in: number }>("/api/auth/callback", { code });
    setToken(data.token);
    setUser(data.user);
    setRefreshToken(data.refresh_token);
    const expiresAt = Date.now() + data.expires_in * 1000;
    setTokenExpiry(expiresAt);
    setState({
      user: data.user, token: data.token, refreshToken: data.refresh_token,
      tokenExpiresAt: expiresAt, isAuthenticated: true, isLoading: false,
    });
    return data.user;
  }, [setState]);

  const logout = useCallback(() => {
    const token = getToken();
    if (token) {
      fetch(`${API_BASE_URL}/api/auth/logout`, {
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
    setState({ user: null, token: null, refreshToken: null, tokenExpiresAt: null, isAuthenticated: false, isLoading: false });
  }, [setState]);

  const { showModal, handleContinue, handleLogout } = useInactivity(state.isAuthenticated, logout);

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
