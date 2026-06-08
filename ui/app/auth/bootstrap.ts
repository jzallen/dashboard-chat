// Dev-login orchestration.
//
// Two pre-auth endpoints against the auth-proxy, covering the AUTH_MODE=dev
// happy path (no WorkOS CSRF `state` round-trip):
//
//   login()           GET  /api/auth/login    -> { url }   -> navigate there.
//                     In dev the url is .../auth/callback?code=dev-auth-code,
//                     i.e. it points straight back at this app.
//   handleCallback()  POST /api/auth/callback { code } -> 200. The auth-proxy
//                     sets the auth_token (httpOnly) + session=1 cookies on the
//                     response, so there is nothing to read from the body — the
//                     caller just navigates into the app.

interface LoginResponse {
  url: string;
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
  // The session cookies are set by this response; do not read the body token.
}

// Pull the ?code= out of a /auth/callback URL. Exported for the entry gate
// (and unit-tested independently of the network round-trip).
export function extractCode(search: string): string | null {
  return new URLSearchParams(search).get("code");
}
