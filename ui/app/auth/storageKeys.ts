// Single source of truth for the browser-storage keys the auth flow shares by
// name across modules. Previously each key was a bare string literal repeated at
// its read and write sites (e.g. the `session` cookie was written as
// `"session=; …"` in one module but matched as `"session=1"` in another) —
// connascence of name with no contract, so a rename in one place failed silently
// in the other. Importing these constants makes the coupling explicit and the
// read/clear sites derive from the same name.

/** Name of the JS-readable session-presence flag cookie (value `1` when set). */
export const SESSION_COOKIE = "session";

/** sessionStorage/localStorage keys the auth flow reads and writes. */
export const STORAGE_KEYS = {
  /** In-flight WorkOS CSRF state, stashed between login() and the callback. */
  oauthState: "oauth_state",
  /** Wall-clock of the last debounced real input (drives keep-alive + idle). */
  lastActivity: "last_activity_ts",
} as const;
