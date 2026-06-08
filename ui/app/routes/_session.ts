// Test scaffold: drive the cookie-session gate the way the auth-proxy does.
//
// The auth gate is now `hasSession()` (app/auth/tokenStorage), which reads the
// JS-readable `session=1` flag cookie. Route tests seed/clear that flag through
// these helpers instead of the retired localStorage token. Not a real route —
// RRv7 routing is declared in routes.ts, so this `_`-prefixed file is ignored.

/** Seed the `session=1` flag so `hasSession()` reports a signed-in user. */
export function signIn(): void {
  document.cookie = "session=1; Path=/";
}

/** Clear the `session=1` flag so `hasSession()` reports a signed-out user. */
export function signOut(): void {
  document.cookie = "session=; Max-Age=0; Path=/";
}
