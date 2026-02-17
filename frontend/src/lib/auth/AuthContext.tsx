import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import type { AuthUser, AuthState } from "./types";
import { post, get } from "../api/client";
import { TOKEN_KEY, REFRESH_TOKEN_KEY, EXPIRES_AT_KEY, ensureFreshToken } from "../api/fetchUtils";
import { ActivityCheckModal } from "../ui/components/ActivityCheckModal";

const AUTH_MODE = import.meta.env.VITE_AUTH_MODE || "workos";
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
    user: null, token: null, refreshToken: null, tokenExpiresAt: null, isAuthenticated: false, isLoading: true,
  });

  // Ref to latest logout so the refresh timer can call it without stale closure
  const logoutRef = useRef<() => void>(() => {});

  // On mount: restore from localStorage or auto-auth in dev mode
  useEffect(() => {
    if (AUTH_MODE === "dev") {
      localStorage.setItem(TOKEN_KEY, DEV_TOKEN);
      localStorage.setItem(USER_KEY, JSON.stringify(DEV_USER));
      localStorage.setItem(REFRESH_TOKEN_KEY, "dev-refresh-token-001");
      const devExpiresAt = Date.now() + 300000;
      localStorage.setItem(EXPIRES_AT_KEY, String(devExpiresAt));
      setState({
        user: DEV_USER, token: DEV_TOKEN, refreshToken: "dev-refresh-token-001",
        tokenExpiresAt: devExpiresAt, isAuthenticated: true, isLoading: false,
      });
      return;
    }
    const token = localStorage.getItem(TOKEN_KEY);
    const userJson = localStorage.getItem(USER_KEY);
    if (token && userJson) {
      try {
        const user = JSON.parse(userJson) as AuthUser;
        const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
        const expiresAtStr = localStorage.getItem(EXPIRES_AT_KEY);
        const tokenExpiresAt = expiresAtStr ? Number(expiresAtStr) : null;
        setState({ user, token, refreshToken, tokenExpiresAt, isAuthenticated: true, isLoading: false });
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
    const data = await post<{ user: AuthUser; token: string; refresh_token: string; expires_in: number }>("/api/auth/callback", { code });
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token);
    const expiresAt = Date.now() + data.expires_in * 1000;
    localStorage.setItem(EXPIRES_AT_KEY, String(expiresAt));
    setState({
      user: data.user, token: data.token, refreshToken: data.refresh_token,
      tokenExpiresAt: expiresAt, isAuthenticated: true, isLoading: false,
    });
    return data.user;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(EXPIRES_AT_KEY);
    setState({ user: null, token: null, refreshToken: null, tokenExpiresAt: null, isAuthenticated: false, isLoading: false });
  }, []);

  // Keep logoutRef up to date
  logoutRef.current = logout;

  // Proactive token refresh timer — delegates to the shared ensureFreshToken()
  // so that the timer and the 401 interceptor share a single coalesced refresh promise.
  useEffect(() => {
    if (!state.tokenExpiresAt || !state.isAuthenticated) return;

    const ttl = state.tokenExpiresAt - Date.now();
    const delay = Math.max(ttl * 0.8, 0);

    const attemptRefresh = async (): Promise<void> => {
      try {
        const newToken = await ensureFreshToken();
        if (newToken) {
          // ensureFreshToken already updated localStorage — read the latest values
          const expiresAtStr = localStorage.getItem(EXPIRES_AT_KEY);
          const expiresAt = expiresAtStr ? Number(expiresAtStr) : null;
          setState(prev => ({
            ...prev,
            token: newToken,
            refreshToken: localStorage.getItem(REFRESH_TOKEN_KEY),
            tokenExpiresAt: expiresAt,
          }));
        } else {
          // No refresh token available or refresh failed after retry
          logoutRef.current();
        }
      } catch {
        logoutRef.current();
      }
    };

    const timerId = setTimeout(attemptRefresh, delay);
    return () => clearTimeout(timerId);
  }, [state.tokenExpiresAt, state.isAuthenticated]);

  // --- Inactivity tracking ---
  const [showActivityModal, setShowActivityModal] = useState(false);
  const lastActivityRef = useRef(Date.now());

  // Register passive event listeners for user interaction
  useEffect(() => {
    if (!state.isAuthenticated) return;

    const updateActivity = () => {
      lastActivityRef.current = Date.now();
    };

    const events: Array<keyof DocumentEventMap> = ["mousedown", "keydown", "scroll", "touchstart"];
    events.forEach((event) => {
      document.addEventListener(event, updateActivity, { passive: true });
    });

    // Check inactivity every 60 seconds
    const intervalId = setInterval(() => {
      const inactiveMs = Date.now() - lastActivityRef.current;
      if (inactiveMs >= 60 * 60 * 1000) {
        setShowActivityModal(true);
      }
    }, 60 * 1000);

    return () => {
      events.forEach((event) => {
        document.removeEventListener(event, updateActivity);
      });
      clearInterval(intervalId);
    };
  }, [state.isAuthenticated]);

  const handleActivityContinue = useCallback(() => {
    lastActivityRef.current = Date.now();
    setShowActivityModal(false);
  }, []);

  const handleActivityLogout = useCallback(() => {
    setShowActivityModal(false);
    logout();
  }, [logout]);

  return (
    <AuthContext.Provider value={{ ...state, login, logout, handleCallback }}>
      {children}
      <ActivityCheckModal
        isOpen={showActivityModal}
        onContinue={handleActivityContinue}
        onLogout={handleActivityLogout}
      />
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
