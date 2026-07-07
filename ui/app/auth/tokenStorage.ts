// Session presence for the dev-login gate.
//
// The credential now lives in an httpOnly `auth_token` cookie that JS cannot
// read, so the SPA can no longer gate on a stored token. The auth-proxy pairs it
// with a JS-readable `session=1` flag cookie (NOT a secret) — `hasSession()`
// reads that flag to answer the client-only "am I signed in?" question. The
// server stays authoritative: it 401s an absent/invalid credential regardless of
// the flag, so a stale flag at worst costs one redirect after a 401.
//
// Pure browser code; never runs during SSR (this app is SPA-only).
import { SESSION_COOKIE, STORAGE_KEYS } from "./storageKeys";

/** True iff the JS-readable `session=1` flag cookie is present. */
export function hasSession(): boolean {
  return document.cookie
    .split(";")
    .map((pair) => pair.trim())
    .some((pair) => pair === `${SESSION_COOKIE}=1`);
}

/** Drop the JS-readable `session=1` flag so hasSession() reads false. Used when a
 *  401 reveals the credential cookie has lapsed even though the flag lingered —
 *  otherwise /login would bounce a "still signed in" principal straight back into
 *  the app and loop. (The httpOnly auth_token is cleared server-side on logout.) */
export function clearSessionFlag(): void {
  document.cookie = `${SESSION_COOKIE}=; path=/; max-age=0`;
}

// ── last-activity tracking (ported from frontend/src/core/auth) ──
// The idle tracker stamps the wall-clock of the last *debounced* real input here
// (localStorage → per-origin + cross-tab, so activity in one tab keeps every tab
// alive). It drives both the keep-alive beat and the inactivity auto-logout.
const ACTIVITY_KEY = STORAGE_KEYS.lastActivity;

export function getLastActivity(): number | null {
  const raw = localStorage.getItem(ACTIVITY_KEY);
  if (raw === null) return null;
  const ts = Number.parseInt(raw, 10);
  return Number.isFinite(ts) ? ts : null;
}

export function setLastActivity(ts: number): void {
  localStorage.setItem(ACTIVITY_KEY, String(ts));
}

export function clearLastActivity(): void {
  localStorage.removeItem(ACTIVITY_KEY);
}
