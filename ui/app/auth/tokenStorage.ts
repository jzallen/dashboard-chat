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

/** True iff the JS-readable `session=1` flag cookie is present. */
export function hasSession(): boolean {
  return document.cookie
    .split(";")
    .map((pair) => pair.trim())
    .some((pair) => pair === "session=1");
}
