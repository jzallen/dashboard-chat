import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import type { AuthUser, AuthState } from "./types";
import { post, get } from "../api/client";

const AUTH_MODE = import.meta.env.VITE_AUTH_MODE || "workos";
const TOKEN_KEY = "auth_token";
const USER_KEY = "auth_user";

interface AuthContextValue extends AuthState {
  login: (organizationId?: string) => Promise<void>;
  logout: () => void;
  handleCallback: (code: string) => Promise<AuthUser>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Dev mode defaults
const DEV_USER: AuthUser = { id: "dev-user-001", email: "dev@localhost", org_id: "dev-org-001", name: "Dev User" };
const DEV_TOKEN = "dev-token-static";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null, token: null, isAuthenticated: false, isLoading: true,
  });

  // On mount: restore from localStorage or auto-auth in dev mode
  useEffect(() => {
    if (AUTH_MODE === "dev") {
      localStorage.setItem(TOKEN_KEY, DEV_TOKEN);
      localStorage.setItem(USER_KEY, JSON.stringify(DEV_USER));
      setState({ user: DEV_USER, token: DEV_TOKEN, isAuthenticated: true, isLoading: false });
      return;
    }
    const token = localStorage.getItem(TOKEN_KEY);
    const userJson = localStorage.getItem(USER_KEY);
    if (token && userJson) {
      try {
        const user = JSON.parse(userJson) as AuthUser;
        setState({ user, token, isAuthenticated: true, isLoading: false });
      } catch {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        setState(s => ({ ...s, isLoading: false }));
      }
    } else {
      setState(s => ({ ...s, isLoading: false }));
    }
  }, []);

  const login = useCallback(async (organizationId?: string) => {
    const params = organizationId ? `?organization_id=${encodeURIComponent(organizationId)}` : "";
    const { url } = await get<{ url: string }>(`/api/auth/login${params}`);
    window.location.href = url;
  }, []);

  const handleCallback = useCallback(async (code: string): Promise<AuthUser> => {
    const { user, token } = await post<{ user: AuthUser; token: string }>("/api/auth/callback", { code });
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    setState({ user, token, isAuthenticated: true, isLoading: false });
    return user;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setState({ user: null, token: null, isAuthenticated: false, isLoading: false });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, logout, handleCallback }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
