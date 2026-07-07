// Login orchestration — covers BOTH auth modes.
//
//   AUTH_MODE=dev (no WorkOS CSRF `state` round-trip):
//     login()          GET  /api/auth/login    -> { url } -> navigate there. The
//                      url is .../auth/callback?code=dev-auth-code, i.e. it points
//                      straight back at this app.
//     handleCallback() POST /api/auth/callback { code } -> 200.
//
//   AUTH_MODE=workos (WorkOS CSRF `state` round-trip):
//     login()          GET  /api/auth/login    -> { url, state }. The auth-proxy
//                      minted `state` and remembered it; we stash it in
//                      sessionStorage and send the browser to the WorkOS url.
//     handleCallback() WorkOS redirects back to /auth/callback?code=…&state=…; the
//                      echoed `state` is compared against the stashed value (client
//                      CSRF check) and POSTed alongside the code:
//                      POST /api/auth/callback { code, state } -> 200. The
//                      auth-proxy re-checks `state` against the value it minted —
//                      a missing/unknown state is rejected with 400 state_mismatch.
//
// In both flows the 200 carries auth_token (httpOnly) + session=1 via Set-Cookie,
// so there is nothing to read from the body — the caller just navigates in.

import { z } from "zod";

import { STORAGE_KEYS } from "./storageKeys";

interface LoginResponse {
  url: string;
  // workos mode only — the CSRF state to echo back at the callback.
  state?: string;
}

// sessionStorage key holding the in-flight WorkOS CSRF state between login() and
// the callback. sessionStorage is per-origin and per-tab, so it survives the
// WorkOS authorize redirect round-trip (unlike an in-memory variable).
const OAUTH_STATE_KEY = STORAGE_KEYS.oauthState;

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
  const { url, state } = (await res.json()) as LoginResponse;
  // workos mode returns a CSRF `state`; stash it so the callback can echo it back
  // and the auth-proxy's remembered-state check passes. dev mode omits it.
  if (state) sessionStorage.setItem(OAUTH_STATE_KEY, state);
  window.location.href = url;
}

export async function handleCallback(
  code: string,
  state?: string,
): Promise<void> {
  // workos mode: the auth-proxy minted this `state` at /api/auth/login and
  // requires it back (else 400 state_mismatch). Compare the echoed value against
  // the one we stashed (client-side CSRF check) before forwarding. dev mode
  // passes no state and skips the round-trip entirely.
  if (state) {
    const stashed = sessionStorage.getItem(OAUTH_STATE_KEY);
    if (!stashed || stashed !== state) {
      throw new Error("callback failed: state mismatch");
    }
  }
  const res = await fetch("/api/auth/callback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state ? { code, state } : { code }),
  });
  if (!res.ok) throw new Error(`callback failed: ${res.status}`);
  // One-shot: drop the stashed state so a replayed callback can't reuse it.
  if (state) sessionStorage.removeItem(OAUTH_STATE_KEY);
  // The session cookies are set by this response; do not read the body token.
}

// Pull the ?code= out of a /auth/callback URL. Exported for the entry gate
// (and unit-tested independently of the network round-trip).
export function extractCode(search: string): string | null {
  return new URLSearchParams(search).get("code");
}

// Pull the ?state= out of a /auth/callback URL (workos mode; null in dev).
export function extractState(search: string): string | null {
  return new URLSearchParams(search).get("state");
}
