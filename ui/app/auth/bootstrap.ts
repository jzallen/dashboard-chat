// Dev-login orchestration.
//
// Two pre-auth endpoints against the auth-proxy, covering the AUTH_MODE=dev
// happy path (no WorkOS CSRF `state` round-trip):
//
//   login()           GET  /api/auth/login    -> { url }   -> navigate there.
//                     In dev the url is .../auth/callback?code=dev-auth-code,
//                     i.e. it points straight back at this app.
//   handleCallback()  POST /api/auth/callback { code } -> { access_token,
//                     expires_in } -> persist the JWT for replay as a Bearer.
import { setToken } from "./tokenStorage";

interface LoginResponse {
  url: string;
}

interface CallbackResponse {
  access_token: string;
  expires_in: number;
}

export async function login(): Promise<void> {
  const res = await fetch("/api/auth/login");
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  const { url } = (await res.json()) as LoginResponse;
  window.location.href = url;
}

export async function handleCallback(code: string): Promise<void> {
  const res = await fetch("/api/auth/callback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw new Error(`callback failed: ${res.status}`);
  const { access_token, expires_in } = (await res.json()) as CallbackResponse;
  setToken(access_token, expires_in);
}

// Pull the ?code= out of a /auth/callback URL. Exported for the entry gate
// (and unit-tested independently of the network round-trip).
export function extractCode(search: string): string | null {
  return new URLSearchParams(search).get("code");
}
