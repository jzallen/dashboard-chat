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

import { z } from "zod";

interface LoginResponse {
  url: string;
}

// ───────────────────────────── auth-mode discovery (CDO-S5; ADR-050 §d) ─────────────────────────────
//
// GET /api/auth/config → { mode: "dev" | "workos" }. Side-effect-free; the
// untrusted body is Zod-validated at the ui/ boundary (unknown future fields are
// ignored via passthrough) and the resolved promise is MEMOIZED at module level,
// so the config is fetched at most once per app load.

const authConfigSchema = z
  .object({ mode: z.enum(["dev", "workos"]) })
  .passthrough();

export type AuthConfig = { mode: "dev" | "workos" };

let authConfigPromise: Promise<AuthConfig> | null = null;

export function fetchAuthConfig(): Promise<AuthConfig> {
  if (!authConfigPromise) {
    authConfigPromise = (async () => {
      const res = await fetch("/api/auth/config");
      if (!res.ok) throw new Error(`auth config failed: ${res.status}`);
      const parsed = authConfigSchema.parse(await res.json());
      return { mode: parsed.mode };
    })();
  }
  return authConfigPromise;
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
