// Session-lifecycle network actions: the keep-alive beat and logout.
//
// keepAlive() is the single "I'm still here" beat the idle tracker fires
// (debounced ~5 min): it bumps the ui-state sliding TTL AND refreshes the auth
// session in one shot, keeping the two coupled so neither drifts (an active
// session never dies; an idle one lapses together). logout() ends the session.
import { clearLastActivity } from "./tokenStorage";

/**
 * Refresh both halves of the session in one beat — best-effort (a failed beat is
 * retried on the next activity window). Both ride the httpOnly cookie via
 * `credentials: "include"`; neither response body is read (the touch is 204, the
 * refresh re-sets the cookie server-side).
 */
export async function keepAlive(): Promise<void> {
  await Promise.allSettled([
    // (B) bump the ui-state sliding TTL for this principal's keys.
    fetch("/ui-state/state/keepalive", {
      method: "POST",
      credentials: "include",
    }),
    // refresh the auth session so the access-token cookie does not lapse at 1h
    // while the user is active (the auth-proxy re-sets the cookie on this call).
    fetch("/api/auth/refresh", { method: "POST", credentials: "include" }),
  ]);
}

/**
 * End the session. Clears the local activity stamp, asks the auth-proxy to drop
 * the server session + cookies, and — when the auth-proxy returns a WorkOS
 * end-session `logout_url` (workos mode) — hands the browser there so the SSO
 * session is actually terminated (otherwise the next login would silently
 * re-authenticate). Falls back to a local redirect to `/login` (dev mode / no
 * url / any failure).
 */
export async function logout(): Promise<void> {
  clearLastActivity();
  // Clear this principal's ui-state flow FIRST, while the cookie is still valid
  // (the /ui-state proxy needs it), so a re-login re-derives from the backend
  // rather than resuming a stale `engaged` snapshot. Best-effort.
  await fetch("/ui-state/state/logout", {
    method: "POST",
    credentials: "include",
  }).catch(() => undefined);

  let redirectUrl = "/login";
  try {
    const res = await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    if (res.ok) {
      // 204 (dev) → no body; workos → { logout_url }. Tolerate either.
      const body = (await res.json().catch(() => null)) as {
        logout_url?: unknown;
      } | null;
      if (body && typeof body.logout_url === "string" && body.logout_url) {
        redirectUrl = body.logout_url;
      }
    }
  } catch {
    // Best-effort — fall through to the local /login redirect.
  }
  window.location.assign(redirectUrl);
}
