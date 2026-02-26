import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import type { AuthUser, AuthState } from "./types";
import { post, get, API_BASE_URL } from "../api/client";
import { TOKEN_KEY, REFRESH_TOKEN_KEY, EXPIRES_AT_KEY, ACTIVITY_KEY, ensureFreshToken } from "../api/fetchUtils";
import { ActivityCheckModal } from "../ui/components/ActivityCheckModal";
import { ActivityDebugBadge } from "../ui/components/ActivityDebugBadge";

const AUTH_MODE = import.meta.env.VITE_AUTH_MODE || "workos";
const USER_KEY = "auth_user";

const ACTIVITY_DEBOUNCE_MS = 5 * 60 * 1000; // 5 minutes
const INACTIVITY_THRESHOLD_MS = 20 * 60 * 1000; // 20 minutes

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
    const { url, state } = await get<{ url: string; state: string }>(`/api/auth/login${params}`);
    if (state) {
      sessionStorage.setItem("oauth_state", state);
    }
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
    // Best-effort server-side session revocation before clearing local state.
    // Fire-and-forget: we always clear localStorage regardless of the outcome.
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      fetch(`${API_BASE_URL}/api/auth/logout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      }).catch(() => {
        // Revocation failure is non-fatal — local state is cleared below
      });
    }

    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(EXPIRES_AT_KEY);
    localStorage.removeItem(ACTIVITY_KEY);
    setState({ user: null, token: null, refreshToken: null, tokenExpiresAt: null, isAuthenticated: false, isLoading: false });
  }, []);

  // Proactive token refresh timer — delegates to the shared ensureFreshToken()
  // so that the timer and the 401 interceptor share a single coalesced refresh promise.
  useEffect(() => {
    // Dev tokens never expire — skip refresh to avoid unnecessary 401/429 noise
    if (AUTH_MODE === "dev") return;
    if (!state.tokenExpiresAt || !state.isAuthenticated) return;

    const ttl = state.tokenExpiresAt - Date.now();
    const delay = Math.max(ttl * 0.8, 10_000);

    let retryTimerId: ReturnType<typeof setTimeout> | null = null;
    let attemptCount = 0;

    const attemptRefresh = async (): Promise<void> => {
      attemptCount++;
      try {
        const newToken = await ensureFreshToken();
        if (newToken) {
          const expiresAtStr = localStorage.getItem(EXPIRES_AT_KEY);
          const expiresAt = expiresAtStr ? Number(expiresAtStr) : null;
          setState(prev => ({
            ...prev,
            token: newToken,
            refreshToken: localStorage.getItem(REFRESH_TOKEN_KEY),
            tokenExpiresAt: expiresAt,
          }));
          return; // success — the effect will re-run with new tokenExpiresAt
        }
      } catch {
        // fall through to retry logic
      }

      // Refresh failed — retry or give up
      if (attemptCount < 3) {
        const retryDelay = attemptCount === 1 ? 30_000 : 60_000;
        console.warn(`[auth] Proactive refresh failed (attempt ${attemptCount}/3), retrying in ${retryDelay / 1000}s`);
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
  }, [state.tokenExpiresAt, state.isAuthenticated]);

  // --- Cross-tab sync ---
  useEffect(() => {
    if (!state.isAuthenticated) return;

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === EXPIRES_AT_KEY && e.newValue) {
        // Another tab refreshed the token — sync state
        const token = localStorage.getItem(TOKEN_KEY);
        const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
        const tokenExpiresAt = Number(e.newValue);
        if (token) {
          setState(prev => ({ ...prev, token, refreshToken, tokenExpiresAt }));
        }
      } else if (e.key === TOKEN_KEY && !e.newValue) {
        // Another tab logged out — clear local state
        setState({
          user: null, token: null, refreshToken: null, tokenExpiresAt: null,
          isAuthenticated: false, isLoading: false,
        });
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [state.isAuthenticated]);

  // --- Inactivity tracking ---
  const [showActivityModal, setShowActivityModal] = useState(false);

  // Register passive event listeners for user interaction
  useEffect(() => {
    if (!state.isAuthenticated) return;

    if (!localStorage.getItem(ACTIVITY_KEY)) {
      localStorage.setItem(ACTIVITY_KEY, String(Date.now()));
    }

    const updateActivity = () => {
      const now = Date.now();
      const last = Number(localStorage.getItem(ACTIVITY_KEY) || "0");
      if (now - last > ACTIVITY_DEBOUNCE_MS) {
        localStorage.setItem(ACTIVITY_KEY, String(now));
      }
    };

    const events: Array<keyof DocumentEventMap> = ["mousedown", "keydown", "scroll", "touchstart"];
    events.forEach((event) => {
      document.addEventListener(event, updateActivity, { passive: true });
    });

    // Check inactivity every 60 seconds
    const intervalId = setInterval(() => {
      const lastStr = localStorage.getItem(ACTIVITY_KEY);
      const lastActivity = lastStr ? Number(lastStr) : Date.now();
      const inactiveMs = Date.now() - lastActivity;
      if (inactiveMs >= INACTIVITY_THRESHOLD_MS) {
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
    localStorage.setItem(ACTIVITY_KEY, String(Date.now()));
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
      {import.meta.env.VITE_DEBUG_ACTIVITY === "true" && <ActivityDebugBadge />}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
