// Token persistence for the dev-login gate. The JWT is stored under
// "auth_token" (with "auth_token_expires_at") for replay as a Bearer on API
// calls. Pure browser code; never runs during SSR (this app is SPA-only).

const TOKEN_KEY = "auth_token";
const EXPIRES_AT_KEY = "auth_token_expires_at";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string, expiresIn?: number): void {
  localStorage.setItem(TOKEN_KEY, token);
  if (expiresIn != null) {
    const expiresAt = Date.now() + expiresIn * 1000;
    localStorage.setItem(EXPIRES_AT_KEY, String(expiresAt));
  }
}

export function clearAll(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EXPIRES_AT_KEY);
}
