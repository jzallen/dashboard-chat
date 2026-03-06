import type { AuthUser } from "./types";

const TOKEN_KEY = "auth_token";
const REFRESH_TOKEN_KEY = "auth_refresh_token";
const EXPIRES_AT_KEY = "auth_token_expires_at";
const ACTIVITY_KEY = "last_activity_ts";
const USER_KEY = "auth_user";

// --- Getter/Setter pairs ---

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setRefreshToken(token: string): void {
  localStorage.setItem(REFRESH_TOKEN_KEY, token);
}

export function getTokenExpiry(): number | null {
  const val = localStorage.getItem(EXPIRES_AT_KEY);
  return val ? Number(val) : null;
}

export function setTokenExpiry(expiresAt: number): void {
  localStorage.setItem(EXPIRES_AT_KEY, String(expiresAt));
}

export function getLastActivity(): number | null {
  const val = localStorage.getItem(ACTIVITY_KEY);
  return val ? Number(val) : null;
}

export function setLastActivity(timestamp: number): void {
  localStorage.setItem(ACTIVITY_KEY, String(timestamp));
}

export function getUser(): AuthUser | null {
  const val = localStorage.getItem(USER_KEY);
  if (!val) return null;
  try {
    return JSON.parse(val) as AuthUser;
  } catch {
    return null;
  }
}

export function setUser(user: AuthUser): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

// --- Key predicates for cross-tab sync ---

export function isTokenKey(key: string | null): boolean {
  return key === TOKEN_KEY;
}

export function isExpiryKey(key: string | null): boolean {
  return key === EXPIRES_AT_KEY;
}

// --- Auth headers ---

export function getAuthHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// --- Bulk cleanup ---

export function clearAll(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(EXPIRES_AT_KEY);
  localStorage.removeItem(ACTIVITY_KEY);
  localStorage.removeItem(USER_KEY);
}

export function hardLogout(): void {
  clearAll();
  window.location.href = "/login";
}
